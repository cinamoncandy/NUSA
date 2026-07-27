# Independent Safety Verifier

The verifier has its own mandatory drill set and recomputes drill and aggregate hashes.
It does not import runner decision, pass/fail, or hash helpers. It rejects altered
decisions, reason ordering, result hashes, missing/duplicate drills, blocked mutations,
and unsafe restart states.

The verifier is a Paper-only assurance control. A passing verifier does not create
trading, deployment, credential, or capital-movement authority.
