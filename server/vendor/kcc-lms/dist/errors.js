/**
 * The module's errors.
 *
 * Typed rather than strings, so a host can map them onto its own HTTP
 * responses without matching on message text. `LmsForbidden` is the one that
 * matters: it means the viewer is not entitled, and a host that renders it as
 * anything other than a refusal has an authorisation bug.
 */
export class LmsError extends Error {
    constructor(message) {
        super(message);
        this.name = new.target.name;
    }
}
/** The viewer may not do this, or may not see this thing. */
export class LmsForbidden extends LmsError {
}
/** The thing does not exist — or does, and the viewer may not know that. */
export class LmsNotFound extends LmsError {
}
/** The input is wrong. The message is safe to show a person. */
export class LmsInvalid extends LmsError {
}
/** The rules say no: out of attempts, already submitted, cohort closed. */
export class LmsConflict extends LmsError {
}
