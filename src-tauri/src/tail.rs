//! Incremental token-usage tailer for Claude Code transcript jsonl files.
//! Remembers a byte offset so a multi-MB transcript is read once, then only
//! the new bytes per poll. A partial trailing line is carried between polls.

use crate::model::TokenTotals;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

pub struct Tailer {
    path: PathBuf,
    offset: u64,
    carry: String,
    pub totals: TokenTotals,
    pub last_model: Option<String>,
}

impl Tailer {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            offset: 0,
            carry: String::new(),
            totals: TokenTotals::default(),
            last_model: None,
        }
    }

    /// Read any new bytes and fold usage into totals. Returns true if changed.
    pub fn poll(&mut self) -> bool {
        let Ok(mut file) = File::open(&self.path) else {
            return false;
        };
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        if len < self.offset {
            // Truncated/rotated — rescan from scratch.
            self.offset = 0;
            self.carry.clear();
            self.totals = TokenTotals::default();
        }
        if len == self.offset {
            return false;
        }
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return false;
        }
        let mut buf = String::new();
        if file.read_to_string(&mut buf).is_err() {
            // Likely split a multi-byte char at the offset; retry full scan next time.
            self.offset = 0;
            self.carry.clear();
            self.totals = TokenTotals::default();
            return false;
        }
        self.offset = len;

        let data = std::mem::take(&mut self.carry) + &buf;
        let mut changed = false;
        let mut rest = data.as_str();
        while let Some(nl) = rest.find('\n') {
            let line = &rest[..nl];
            rest = &rest[nl + 1..];
            changed |= self.ingest_line(line);
        }
        self.carry = rest.to_string();
        changed
    }

    fn ingest_line(&mut self, line: &str) -> bool {
        let Ok(json) = serde_json::from_str::<serde_json::Value>(line) else {
            return false;
        };
        let Some(message) = json.get("message") else {
            return false;
        };
        if let Some(model) = message.get("model").and_then(|m| m.as_str()) {
            self.last_model = Some(model.to_string());
        }
        let Some(usage) = message.get("usage") else {
            return false;
        };
        let get = |key: &str| usage.get(key).and_then(|v| v.as_u64()).unwrap_or(0);
        self.totals.input += get("input_tokens");
        self.totals.output += get("output_tokens");
        self.totals.cache_read += get("cache_read_input_tokens");
        self.totals.cache_creation += get("cache_creation_input_tokens");
        true
    }
}
