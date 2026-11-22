//! The fork's PyIdea features (FORK.md): domain logic behind `ide-host`'s `ops::fork`
//! commands. Builds the commands and parses what the tools print; the host resolves and
//! runs the tools.

pub mod deps;
pub mod mojo;
pub mod ruff;
pub mod tests;
pub mod toml;
pub mod web;
