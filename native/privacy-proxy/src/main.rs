//! Entry point.
//!
//! Deliberately thin. Everything portable (`--version`, `--help`, `--check`)
//! is handled here so a developer can validate a config file on any platform;
//! the datapath itself is Linux-only and lives in [`polysiem_privacy_proxy::server`].

use std::process::ExitCode;

use polysiem_privacy_proxy::config::Config;
use polysiem_privacy_proxy::VERSION;

const USAGE: &str = "\
polysiem-privacy-proxy - SNI-inspecting transparent TCP proxy for the PolySIEM privacy router

USAGE:
    polysiem-privacy-proxy --config <path> [--stats <path>]
    polysiem-privacy-proxy --check <path>
    polysiem-privacy-proxy --probe <if0,if1,...> [--probe-timeout <seconds>]
    polysiem-privacy-proxy --version

OPTIONS:
    --config <path>          Configuration file. Re-read on SIGHUP.
    --stats <path>           Stats file, rewritten atomically every 5s and on SIGUSR1.
    --check <path>           Parse a configuration file, report problems, exit.
    --probe <list>           Report whether each named exit interface is usable.
    --probe-timeout <secs>   Per-interface probe budget. Default 2.
    --version                Print the version and exit.

SIGNALS:
    SIGHUP    re-read the configuration. A malformed file is logged and IGNORED;
              the previous configuration keeps serving and the proxy does not exit.
    SIGUSR1   write the stats file immediately.
    SIGTERM   drain and exit.
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.iter().any(|arg| arg == "--version" || arg == "-V") {
        println!("polysiem-privacy-proxy {VERSION}");
        return ExitCode::SUCCESS;
    }
    if args.is_empty() || args.iter().any(|arg| arg == "--help" || arg == "-h") {
        print!("{USAGE}");
        return if args.is_empty() {
            ExitCode::from(2)
        } else {
            ExitCode::SUCCESS
        };
    }

    if let Some(path) = flag_value(&args, "--check") {
        return check_config(&path);
    }

    run(&args)
}

/// Parse a config file and report what is wrong with it, if anything.
fn check_config(path: &str) -> ExitCode {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("cannot read {path}: {error}");
            return ExitCode::from(2);
        }
    };
    match Config::parse(&text) {
        Ok(config) => {
            println!(
                "ok: {} listener(s), {} exit(s), {} rule(s), default {:?}, maxFlows {}",
                config.listeners.len(),
                config.exits.len(),
                config.rules.len(),
                config.default_action,
                config.max_flows,
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{path}: {error}");
            ExitCode::from(1)
        }
    }
}

/// `--flag value`, or `None`.
fn flag_value(args: &[String], flag: &str) -> Option<String> {
    let at = args.iter().position(|arg| arg == flag)?;
    args.get(at.checked_add(1)?).cloned()
}

#[cfg(target_os = "linux")]
fn run(args: &[String]) -> ExitCode {
    polysiem_privacy_proxy::server::run(args)
}

#[cfg(not(target_os = "linux"))]
fn run(_args: &[String]) -> ExitCode {
    // The datapath is `splice`, `epoll`, `SO_ORIGINAL_DST` and `SO_BINDTODEVICE`.
    // None of those have an equivalent elsewhere, so there is nothing to
    // usefully emulate - say so plainly instead of failing obscurely.
    eprintln!(
        "polysiem-privacy-proxy {VERSION}: the proxy datapath requires Linux. \
         `--check` and `--version` work anywhere."
    );
    ExitCode::from(2)
}
