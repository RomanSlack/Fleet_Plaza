//! Integration tests for the tmux bridge and correlation logic.
//! Hermetic: uses a stub long-running process instead of the real `claude`,
//! and a temp dir standing in for ~/.claude. Requires a working `tmux`.

use fleet_plaza_lib::{correlate, tmux};
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

const TEST_AGENT: &str = "fleettest";

struct SessionGuard;
impl Drop for SessionGuard {
    fn drop(&mut self) {
        let _ = tmux::kill(TEST_AGENT);
    }
}

fn wait_for<T>(timeout: Duration, mut f: impl FnMut() -> Option<T>) -> Option<T> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if let Some(v) = f() {
            return Some(v);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

fn proc_starttime(pid: i32) -> String {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let rest = &stat[stat.rfind(')').unwrap() + 2..];
    rest.split_whitespace().nth(19).unwrap().to_string()
}

#[test]
fn discover_correlate_kill_roundtrip() {
    let _ = tmux::kill(TEST_AGENT);
    let _guard = SessionGuard;

    // Spawn a stub "claude" (a sleeping process) via the same tmux path.
    tmux::spawn_cmd(TEST_AGENT, "/tmp", "sleep 300").expect("tmux spawn failed");

    // 1. Discovery sees it.
    let pane = wait_for(Duration::from_secs(5), || {
        tmux::discover().into_iter().find(|p| p.name == TEST_AGENT)
    })
    .expect("agent not discovered");
    assert_eq!(pane.session, format!("cg/{TEST_AGENT}"));
    assert!(pane.pane_pid > 0);
    assert_eq!(pane.current_path, "/tmp");

    // 2. Correlation: fake a claude home where the *pane shell's pid* has a
    // sessions file with a correct procStart.
    let home = PathBuf::from(format!("/tmp/fleettest-claude-{}", std::process::id()));
    fs::create_dir_all(home.join("sessions")).unwrap();
    let pid = pane.pane_pid;
    fs::write(
        home.join("sessions").join(format!("{pid}.json")),
        serde_json::json!({
            "pid": pid,
            "sessionId": "test-session-id",
            "cwd": "/tmp",
            "status": "idle",
            "updatedAt": 1u64,
            "procStart": proc_starttime(pid),
        })
        .to_string(),
    )
    .unwrap();

    let claude = correlate::find_claude_session(pid, &home).expect("correlation failed");
    assert_eq!(claude.session_id, "test-session-id");
    assert_eq!(claude.status, "idle");

    // 3. procStart mismatch (stale file from a dead/reused pid) is rejected.
    fs::write(
        home.join("sessions").join(format!("{pid}.json")),
        serde_json::json!({
            "pid": pid,
            "sessionId": "stale-session",
            "cwd": "/tmp",
            "status": "busy",
            "updatedAt": 1u64,
            "procStart": "1",
        })
        .to_string(),
    )
    .unwrap();
    assert!(
        correlate::find_claude_session(pid, &home).is_none(),
        "stale sessions file must not correlate"
    );

    // 4. Kill removes it from discovery.
    tmux::kill(TEST_AGENT).expect("kill failed");
    wait_for(Duration::from_secs(5), || {
        let gone = !tmux::discover().iter().any(|p| p.name == TEST_AGENT);
        gone.then_some(())
    })
    .expect("agent still discovered after kill");

    let _ = fs::remove_dir_all(&home);
}

#[test]
fn send_task_lands_in_pane() {
    // Independent session name to avoid clashing with the other test.
    let name = "fleettest-send";
    let _ = tmux::kill(name);
    tmux::spawn_cmd(name, "/tmp", "cat").expect("spawn failed");

    let result = (|| -> Result<(), String> {
        let buf = tmux::stage_text(name, "hello fleet")?;
        std::thread::sleep(Duration::from_millis(600));
        tmux::press_enter(name)?;
        tmux::delete_buffer(&buf);
        let captured = wait_for(Duration::from_secs(5), || {
            tmux::capture(name, 50).ok().filter(|c| c.contains("hello fleet"))
        })
        .ok_or("sent text never appeared in pane")?;
        assert!(captured.contains("hello fleet"));
        Ok(())
    })();

    let _ = tmux::kill(name);
    result.unwrap();
}

#[test]
fn mangle_matches_claude_convention() {
    assert_eq!(
        correlate::mangle_project_path("/home/roman/Fleet_Plaza"),
        "-home-roman-Fleet-Plaza"
    );
    assert_eq!(
        correlate::mangle_project_path("/home/roman/thirdaxis.ai"),
        "-home-roman-thirdaxis-ai"
    );
}

#[test]
fn zone_longest_prefix_match() {
    use fleet_plaza_lib::model::{AppConfig, ProjectZone};
    let config = AppConfig {
        projects: vec![
            ProjectZone {
                id: "a".into(),
                name: "A".into(),
                path: "/home/roman/proj".into(),
                color: "#fff".into(),
                auto: false,
            },
            ProjectZone {
                id: "b".into(),
                name: "B".into(),
                path: "/home/roman/proj/sub".into(),
                color: "#fff".into(),
                auto: false,
            },
        ],
        claude_args: vec![],
    };
    assert_eq!(fleet_plaza_lib::poller::zone_for_path("/home/roman/proj", &config), "a");
    assert_eq!(
        fleet_plaza_lib::poller::zone_for_path("/home/roman/proj/sub/x", &config),
        "b"
    );
    assert_eq!(fleet_plaza_lib::poller::zone_for_path("/elsewhere", &config), "visitors");
}
