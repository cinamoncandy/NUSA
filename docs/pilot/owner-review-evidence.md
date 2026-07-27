# Owner Review Evidence

Owner review evidence contains `reviewId`, `reviewedBy`, `reviewedAt`, `sourceCommitSha`,
`pilotEvidenceSha256`, `decision`, notes, and a deterministic `reviewSha256`. Valid
decisions are `APPROVED_FOR_EXTENDED_PAPER`, `REJECTED`, and
`MORE_OBSERVATION_REQUIRED`. The review must match both the current source commit and
the complete pilot aggregate seal. A command-line flag cannot create approval evidence.
