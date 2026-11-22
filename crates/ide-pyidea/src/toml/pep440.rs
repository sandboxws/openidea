//! Ordering of PEP 440 versions, for version completion: newest stable first.

use std::cmp::Ordering;

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Key {
    epoch: u64,
    release: Vec<u64>,
    /// `(0, 0)` for a dev release with no pre/post (sorts before its pre-releases),
    /// `(1..=3, n)` for a/b/rc, `(4, 0)` for none.
    pre: (u8, u64),
    /// `(0, 0)` for none.
    post: (u8, u64),
    /// `(1, 0)` for none (a dev release sorts before the release it leads to).
    dev: (u8, u64),
}

/// A parsed version, or none when it isn't PEP 440.
fn key(version: &str) -> Option<Key> {
    let v = version.trim().to_ascii_lowercase();
    let v = v.strip_prefix('v').unwrap_or(&v);
    let v = v.split('+').next().unwrap_or(v);
    let (epoch, rest) = match v.split_once('!') {
        Some((e, rest)) => (e.parse().ok()?, rest),
        None => (0, v),
    };
    let bytes = rest.as_bytes();
    let mut i = 0;
    let number = |i: &mut usize| -> Option<u64> {
        let start = *i;
        while *i < bytes.len() && bytes[*i].is_ascii_digit() {
            *i += 1;
        }
        rest[start..*i].parse().ok()
    };
    let mut release = vec![number(&mut i)?];
    while i + 1 < bytes.len() && bytes[i] == b'.' && bytes[i + 1].is_ascii_digit() {
        i += 1;
        release.push(number(&mut i)?);
    }
    while release.len() > 1 && release.last() == Some(&0) {
        release.pop();
    }
    let skip_separator = |i: &mut usize| {
        if *i < bytes.len() && matches!(bytes[*i], b'.' | b'-' | b'_') {
            *i += 1;
        }
    };
    let word = |i: &mut usize, words: &[&str]| -> Option<usize> {
        let found = words.iter().position(|w| rest[*i..].starts_with(w))?;
        *i += words[found].len();
        Some(found)
    };
    let mut pre = None;
    let mut post = None;
    let mut dev = None;
    let save = i;
    skip_separator(&mut i);
    let kinds: [(&[&str], u8); 3] = [(&["alpha", "a"], 1), (&["beta", "b"], 2), (&["preview", "pre", "rc", "c"], 3)];
    if let Some(kind) = kinds.iter().find_map(|(words, kind)| word(&mut i, words).map(|_| *kind)) {
        skip_separator(&mut i);
        pre = Some((kind, number(&mut i).unwrap_or(0)));
    } else {
        i = save;
    }
    let save = i;
    skip_separator(&mut i);
    if word(&mut i, &["post", "rev", "r"]).is_some() {
        skip_separator(&mut i);
        post = Some(number(&mut i).unwrap_or(0));
    } else if i > save && i < bytes.len() && bytes[save] == b'-' && bytes[i].is_ascii_digit() {
        // `1.0-1` is a post release.
        post = number(&mut i);
    } else {
        i = save;
    }
    let save = i;
    skip_separator(&mut i);
    if word(&mut i, &["dev"]).is_some() {
        skip_separator(&mut i);
        dev = Some(number(&mut i).unwrap_or(0));
    } else {
        i = save;
    }
    if i != bytes.len() {
        return None;
    }
    Some(Key {
        epoch,
        release,
        pre: match (pre, post, dev) {
            (Some(p), _, _) => p,
            (None, None, Some(_)) => (0, 0),
            _ => (4, 0),
        },
        post: post.map_or((0, 0), |n| (1, n)),
        dev: dev.map_or((1, 0), |n| (0, n)),
    })
}

/// A pre-release or development release.
pub fn is_prerelease(version: &str) -> bool {
    key(version).is_some_and(|k| k.pre.0 < 4 || k.dev.0 == 0)
}

/// `a` against `b` (unparseable versions last).
pub fn compare(a: &str, b: &str) -> Ordering {
    match (key(a), key(b)) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => Ordering::Greater,
        (None, Some(_)) => Ordering::Less,
        (None, None) => a.cmp(b),
    }
}

/// Newest first: stable releases, then pre-releases, then what isn't PEP 440.
pub fn newest_first(versions: &mut [String]) {
    versions.sort_by(|a, b| {
        let rank = |v: &str| if key(v).is_none() { 2 } else { u8::from(is_prerelease(v)) };
        rank(a).cmp(&rank(b)).then_with(|| compare(b, a))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_like_pep_440() {
        let ordered = [
            "1.0.dev1",
            "1.0a1.dev1",
            "1.0a1",
            "1.0b2",
            "1.0rc1",
            "1.0",
            "1.0.post1.dev1",
            "1.0.post1",
            "1.0.1",
            "1.10",
            "1!0.1",
        ];
        for pair in ordered.windows(2) {
            assert_eq!(compare(pair[0], pair[1]), Ordering::Less, "{} < {}", pair[0], pair[1]);
        }
        assert_eq!(compare("1.0", "1.0.0"), Ordering::Equal);
        assert_eq!(compare("1.0-1", "1.0.post1"), Ordering::Equal);
        assert_eq!(compare("2.0.0+local", "2.0"), Ordering::Equal);
    }

    #[test]
    fn puts_newest_stable_first() {
        let mut versions: Vec<String> =
            ["2.0rc1", "1.9", "not a version", "2.0.dev3", "1.10.0", "1.2"].map(String::from).to_vec();
        newest_first(&mut versions);
        assert_eq!(versions, ["1.10.0", "1.9", "1.2", "2.0rc1", "2.0.dev3", "not a version"]);
        assert!(is_prerelease("3.0b1") && is_prerelease("3.0.dev0") && !is_prerelease("3.0.post1"));
    }
}
