//! Embedded terminal sessions: a PTY running `tmux attach` per open panel,
//! streamed to the frontend as `term_data` events; keystrokes come back via
//! `term_input`. Killing the attach client just detaches — the agent's tmux
//! session is untouched.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::Emitter;

pub struct TermSession {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
}

#[derive(Default)]
pub struct TermState {
    sessions: Mutex<HashMap<String, std::sync::Arc<TermSession>>>,
}

impl TermState {
    pub fn close(&self, name: &str) {
        if let Some(session) = self.sessions.lock().unwrap().remove(name) {
            let _ = session.child.lock().unwrap().kill();
        }
    }
}

pub fn open(
    app: tauri::AppHandle,
    state: &TermState,
    name: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.close(&name);

    // Let the most recently active client define the window size, so the
    // in-panel terminal and an external attach don't fight over it.
    let _ = std::process::Command::new("tmux")
        .args(["set-option", "-t", &format!("=cg/{name}"), "window-size", "latest"])
        .output();

    let pty = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("tmux");
    cmd.args(["attach", "-t", &format!("=cg/{name}")]);
    cmd.env("TERM", "xterm-256color");
    let child = pty.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let mut reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pty.master.take_writer().map_err(|e| e.to_string())?;

    let session = std::sync::Arc::new(TermSession {
        writer: Mutex::new(writer),
        master: Mutex::new(pty.master),
        child: Mutex::new(child),
    });
    state
        .sessions
        .lock()
        .unwrap()
        .insert(name.clone(), session);

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app.emit(
                        "term_data",
                        serde_json::json!({
                            "name": name,
                            "data": String::from_utf8_lossy(&buf[..n]),
                        }),
                    );
                }
            }
        }
        let _ = app.emit("term_exit", serde_json::json!({ "name": name }));
    });

    Ok(())
}

fn session_for(state: &TermState, name: &str) -> Result<std::sync::Arc<TermSession>, String> {
    state
        .sessions
        .lock()
        .unwrap()
        .get(name)
        .cloned()
        .ok_or_else(|| "no terminal session".to_string())
}

pub fn input(state: &TermState, name: &str, data: &str) -> Result<(), String> {
    let session = session_for(state, name)?;
    let result = session
        .writer
        .lock()
        .unwrap()
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string());
    result
}

pub fn resize(state: &TermState, name: &str, cols: u16, rows: u16) -> Result<(), String> {
    let session = session_for(state, name)?;
    let result = session
        .master
        .lock()
        .unwrap()
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string());
    result
}
