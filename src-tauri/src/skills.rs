use crate::model::SkillInfo;
use std::fs;
use std::path::Path;

/// List skills from `<claude_home>/skills/*/SKILL.md` frontmatter.
/// Frontmatter is simple `key: value` lines between `---` fences; a plain
/// line parser is enough (no YAML lib).
pub fn list(claude_home: &Path) -> Vec<SkillInfo> {
    let mut skills = Vec::new();
    let Ok(entries) = fs::read_dir(claude_home.join("skills")) else {
        return skills;
    };
    for entry in entries.flatten() {
        let Ok(content) = fs::read_to_string(entry.path().join("SKILL.md")) else {
            continue;
        };
        let mut name = None;
        let mut description = None;
        let mut in_frontmatter = false;
        for line in content.lines() {
            if line.trim() == "---" {
                if in_frontmatter {
                    break;
                }
                in_frontmatter = true;
                continue;
            }
            if !in_frontmatter {
                continue;
            }
            if let Some(v) = line.strip_prefix("name:") {
                name = Some(v.trim().to_string());
            } else if let Some(v) = line.strip_prefix("description:") {
                description = Some(v.trim().to_string());
            }
        }
        if let Some(name) = name {
            skills.push(SkillInfo {
                name,
                description: description.unwrap_or_default(),
            });
        }
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}
