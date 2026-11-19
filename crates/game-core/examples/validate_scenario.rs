use game_core::scenario::{MAX_JSON_BYTES, load_scenario};
use std::{env, error::Error, fs::File, io::Read, process::ExitCode};

fn run() -> Result<(), Box<dyn Error>> {
    let path = env::args_os()
        .nth(1)
        .ok_or("usage: validate_scenario <scenario.json>")?;
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_JSON_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    let scenario = load_scenario(&bytes)?;
    println!(
        "{}: {}x{}, units={}, objectives={}",
        scenario.id,
        scenario.map.width(),
        scenario.map.height(),
        scenario.units.len(),
        scenario.objectives.len()
    );
    for warning in scenario.warnings {
        eprintln!("warning: {warning:?}");
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
