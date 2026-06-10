use fleet_plaza_lib::tail::Tailer;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

fn usage_line(input: u64, output: u64, cache_read: u64) -> String {
    serde_json::json!({
        "message": {
            "model": "claude-test-1",
            "role": "assistant",
            "usage": {
                "input_tokens": input,
                "output_tokens": output,
                "cache_read_input_tokens": cache_read,
                "cache_creation_input_tokens": 0
            }
        }
    })
    .to_string()
}

#[test]
fn tailer_incremental_and_truncation() {
    let path = PathBuf::from(format!("/tmp/fleettest-tail-{}.jsonl", std::process::id()));
    let _ = std::fs::remove_file(&path);

    let mut write = |lines: &[String]| {
        let mut f = OpenOptions::new().create(true).append(true).open(&path).unwrap();
        for line in lines {
            writeln!(f, "{line}").unwrap();
        }
    };

    // Initial content: two assistant turns + a non-usage line.
    write(&[
        usage_line(100, 20, 500),
        r#"{"type":"user","message":{"role":"user"}}"#.to_string(),
        usage_line(50, 30, 700),
    ]);

    let mut tailer = Tailer::new(path.clone());
    assert!(tailer.poll());
    assert_eq!(tailer.totals.input, 150);
    assert_eq!(tailer.totals.output, 50);
    assert_eq!(tailer.totals.cache_read, 1200);
    assert_eq!(tailer.last_model.as_deref(), Some("claude-test-1"));

    // No new bytes → no change.
    assert!(!tailer.poll());

    // Append → only the delta is folded in.
    write(&[usage_line(10, 5, 0)]);
    assert!(tailer.poll());
    assert_eq!(tailer.totals.input, 160);
    assert_eq!(tailer.totals.output, 55);

    // Truncation/rotation → full rescan from scratch.
    std::fs::write(&path, format!("{}\n", usage_line(7, 3, 1))).unwrap();
    assert!(tailer.poll());
    assert_eq!(tailer.totals.input, 7);
    assert_eq!(tailer.totals.output, 3);
    assert_eq!(tailer.totals.cache_read, 1);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn tailer_handles_partial_trailing_line() {
    let path = PathBuf::from(format!("/tmp/fleettest-tail-partial-{}.jsonl", std::process::id()));
    let _ = std::fs::remove_file(&path);

    let full = usage_line(11, 4, 0);
    let (head, rest) = full.split_at(full.len() / 2);
    std::fs::write(&path, head).unwrap();

    let mut tailer = Tailer::new(path.clone());
    assert!(!tailer.poll(), "half a line must not count");
    assert_eq!(tailer.totals.input, 0);

    let mut f = OpenOptions::new().append(true).open(&path).unwrap();
    writeln!(f, "{rest}").unwrap();
    drop(f);

    assert!(tailer.poll());
    assert_eq!(tailer.totals.input, 11);
    assert_eq!(tailer.totals.output, 4);

    let _ = std::fs::remove_file(&path);
}
