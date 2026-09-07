//! The search bar's little query language.
//!
//! Terms are whitespace separated and ANDed together:
//!
//! ```text
//! mov                 name contains "mov"
//! *.mov               name matches the glob
//! extension:mov       exact extension
//! size:>5GB           allocated-or-logical size
//! unused:>6m          idle for longer than 6 months
//! path:Downloads      path contains "Downloads"
//! kind:video          category
//! size:>5GB unused:>6m
//! ```

use crate::index::files::DAY;
use crate::index::ScanIndex;
use crate::model::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cmp {
    Gt,
    Ge,
    Lt,
    Le,
    Eq,
}

impl Cmp {
    fn test<T: PartialOrd>(self, a: T, b: T) -> bool {
        match self {
            Cmp::Gt => a > b,
            Cmp::Ge => a >= b,
            Cmp::Lt => a < b,
            Cmp::Le => a <= b,
            Cmp::Eq => a == b,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Term {
    /// Case-insensitive substring of the file name.
    Name(String),
    /// Glob over the file name (`*` and `?`).
    Glob(String),
    Ext(String),
    Kind(Category),
    Path(String),
    Size(Cmp, u64),
    /// Days idle.
    Unused(Cmp, f64),
    /// Days since modification.
    Modified(Cmp, f64),
    /// Never matches — a malformed term should return nothing rather than
    /// silently widening the result set.
    Impossible,
}

#[derive(Clone, Debug, Default)]
pub struct Query {
    pub terms: Vec<Term>,
    pub raw: String,
}

impl Query {
    pub fn parse(input: &str) -> Query {
        let mut terms = Vec::new();
        for tok in split_terms(input) {
            if tok.is_empty() {
                continue;
            }
            terms.push(parse_term(&tok));
        }
        Query {
            terms,
            raw: input.to_string(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.terms.is_empty()
    }

    pub fn matches(&self, ix: &ScanIndex, id: u32, now: i64) -> bool {
        if self.terms.is_empty() {
            return true;
        }
        let f = &ix.files[id as usize];
        let name = ix.file_name(id);
        let mut lower_name: Option<String> = None;

        for t in &self.terms {
            let ok = match t {
                Term::Impossible => false,
                Term::Name(needle) => {
                    let ln = lower_name.get_or_insert_with(|| name.to_lowercase());
                    ln.contains(needle)
                }
                Term::Glob(pat) => {
                    let ln = lower_name.get_or_insert_with(|| name.to_lowercase());
                    glob_match(pat, ln)
                }
                Term::Ext(e) => ix.ext_name(f.ext) == e,
                Term::Kind(c) => ix.file_category(id) == *c,
                Term::Path(p) => ix.file_dir_path(id).to_lowercase().contains(p),
                Term::Size(c, v) => c.test(f.alloc.max(f.size), *v),
                Term::Unused(c, days) => {
                    let last = f.effective_last_used();
                    if last == NO_TIME {
                        false
                    } else {
                        c.test(((now - last).max(0) as f64) / DAY as f64, *days)
                    }
                }
                Term::Modified(c, days) => {
                    if f.mtime == NO_TIME {
                        false
                    } else {
                        c.test(((now - f.mtime).max(0) as f64) / DAY as f64, *days)
                    }
                }
            };
            if !ok {
                return false;
            }
        }
        true
    }
}

/// Split on whitespace, but keep `"quoted phrases"` together.
fn split_terms(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    for ch in input.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn parse_term(tok: &str) -> Term {
    if let Some((key, value)) = tok.split_once(':') {
        let key = key.to_ascii_lowercase();
        let value = value.trim();
        if value.is_empty() {
            return Term::Impossible;
        }
        return match key.as_str() {
            "ext" | "extension" | "type" => {
                Term::Ext(value.trim_start_matches('.').to_ascii_lowercase())
            }
            "kind" | "category" => match Category::from_token(value) {
                Some(c) => Term::Kind(c),
                None => Term::Impossible,
            },
            "path" | "in" | "folder" => Term::Path(value.to_lowercase()),
            "size" => match parse_cmp(value).and_then(|(c, r)| parse_size(r).map(|v| (c, v))) {
                Some((c, v)) => Term::Size(c, v),
                None => Term::Impossible,
            },
            "unused" | "idle" | "lastused" => {
                match parse_cmp(value).and_then(|(c, r)| parse_duration_days(r).map(|v| (c, v))) {
                    Some((c, v)) => Term::Unused(c, v),
                    None => Term::Impossible,
                }
            }
            "modified" | "age" => {
                match parse_cmp(value).and_then(|(c, r)| parse_duration_days(r).map(|v| (c, v))) {
                    Some((c, v)) => Term::Modified(c, v),
                    None => Term::Impossible,
                }
            }
            "name" => Term::Name(value.to_lowercase()),
            _ => Term::Name(tok.to_lowercase()),
        };
    }

    if tok.contains('*') || tok.contains('?') {
        return Term::Glob(tok.to_lowercase());
    }
    Term::Name(tok.to_lowercase())
}

fn parse_cmp(s: &str) -> Option<(Cmp, &str)> {
    let s = s.trim();
    if let Some(r) = s.strip_prefix(">=") {
        Some((Cmp::Ge, r))
    } else if let Some(r) = s.strip_prefix("<=") {
        Some((Cmp::Le, r))
    } else if let Some(r) = s.strip_prefix('>') {
        Some((Cmp::Gt, r))
    } else if let Some(r) = s.strip_prefix('<') {
        Some((Cmp::Lt, r))
    } else if let Some(r) = s.strip_prefix('=') {
        Some((Cmp::Eq, r))
    } else {
        // A bare value reads as "at least this much".
        Some((Cmp::Ge, s))
    }
}

/// `10GB`, `500m`, `1.5g`, `4096`.
pub fn parse_size(s: &str) -> Option<u64> {
    let s = s.trim().to_ascii_lowercase();
    let split = s
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(s.len());
    let (num, unit) = s.split_at(split);
    let n: f64 = num.parse().ok()?;
    if !n.is_finite() || n < 0.0 {
        return None;
    }
    let mult: f64 = match unit.trim() {
        "" | "b" => 1.0,
        "k" | "kb" | "kib" => 1024.0,
        "m" | "mb" | "mib" => 1024.0 * 1024.0,
        "g" | "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        "t" | "tb" | "tib" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((n * mult) as u64)
}

/// `7d`, `6m`, `1y`, `2w`, `90` (bare number = days).
pub fn parse_duration_days(s: &str) -> Option<f64> {
    let s = s.trim().to_ascii_lowercase();
    let split = s
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(s.len());
    let (num, unit) = s.split_at(split);
    let n: f64 = num.parse().ok()?;
    if !n.is_finite() || n < 0.0 {
        return None;
    }
    let days = match unit.trim() {
        "" | "d" | "day" | "days" => 1.0,
        "w" | "week" | "weeks" => 7.0,
        "m" | "mo" | "month" | "months" => 30.4375,
        "y" | "yr" | "year" | "years" => 365.25,
        "h" | "hour" | "hours" => 1.0 / 24.0,
        _ => return None,
    };
    Some(n * days)
}

/// Minimal `*`/`?` glob, iterative so it cannot blow the stack.
pub fn glob_match(pat: &str, text: &str) -> bool {
    let p: Vec<char> = pat.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star, mut mark) = (usize::MAX, 0usize);

    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = pi;
            mark = ti;
            pi += 1;
        } else if star != usize::MAX {
            pi = star + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_parse_with_units() {
        assert_eq!(parse_size("1024"), Some(1024));
        assert_eq!(parse_size("1KB"), Some(1024));
        assert_eq!(parse_size("1gb"), Some(1024 * 1024 * 1024));
        assert_eq!(parse_size("1.5G"), Some(1_610_612_736));
        assert_eq!(parse_size("bogus"), None);
    }

    #[test]
    fn durations_parse_with_units() {
        assert_eq!(parse_duration_days("7d"), Some(7.0));
        assert_eq!(parse_duration_days("2w"), Some(14.0));
        assert_eq!(parse_duration_days("1y"), Some(365.25));
        assert!((parse_duration_days("6m").unwrap() - 182.625).abs() < 0.001);
        assert_eq!(parse_duration_days("nope"), None);
    }

    #[test]
    fn globs_match() {
        assert!(glob_match("*.mov", "clip.mov"));
        assert!(!glob_match("*.mov", "clip.mp4"));
        assert!(glob_match("a*b*c", "axxbyyc"));
        assert!(glob_match("*", "anything"));
        assert!(glob_match("????", "abcd"));
        assert!(!glob_match("????", "abc"));
    }

    #[test]
    fn compound_query_parses_every_term() {
        let q = Query::parse("size:>5GB unused:>6m ext:mov");
        assert_eq!(q.terms.len(), 3);
        assert!(matches!(q.terms[0], Term::Size(Cmp::Gt, _)));
        assert!(matches!(q.terms[1], Term::Unused(Cmp::Gt, _)));
        assert!(matches!(q.terms[2], Term::Ext(ref e) if e == "mov"));
    }

    #[test]
    fn malformed_terms_match_nothing() {
        let q = Query::parse("size:>banana");
        assert!(matches!(q.terms[0], Term::Impossible));
        let q = Query::parse("kind:nonsense");
        assert!(matches!(q.terms[0], Term::Impossible));
    }

    #[test]
    fn quoted_phrases_stay_together() {
        let terms = split_terms(r#"path:"My Documents" big"#);
        assert_eq!(terms, vec!["path:My Documents", "big"]);
    }

    #[test]
    fn matching_runs_against_an_index() {
        use crate::index::NO_PARENT;
        let mut ix = ScanIndex::new("/r".into(), "T".into());
        let n = ix.names.push("/r");
        ix.dirs.push(DirRec::new(n, NO_PARENT, 0, flags::IS_DIR));
        let now = 1_760_000_000i64;
        let ext = ix.intern_ext("mov");
        let n = ix.names.push("Final Render.mov");
        ix.files.push(FileRec {
            name: n,
            parent: 0,
            ext,
            size: 8 * 1024 * 1024 * 1024,
            alloc: 8 * 1024 * 1024 * 1024,
            mtime: now - 400 * DAY,
            atime: now - 400 * DAY,
            btime: now - 500 * DAY,
            last_used: now - 400 * DAY,
            flags: 0,
        });
        ix.dirs[0].files.push(0);
        ix.finalize(now);

        assert!(Query::parse("size:>5GB unused:>6m").matches(&ix, 0, now));
        assert!(Query::parse("*.mov").matches(&ix, 0, now));
        assert!(Query::parse("render").matches(&ix, 0, now));
        assert!(Query::parse("kind:video").matches(&ix, 0, now));
        assert!(!Query::parse("size:>20GB").matches(&ix, 0, now));
        assert!(!Query::parse("unused:>3y").matches(&ix, 0, now));
        assert!(Query::parse("path:/r").matches(&ix, 0, now));
    }
}
