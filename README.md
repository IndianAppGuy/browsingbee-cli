# BrowsingBee CLI

Run BrowsingBee browser automation tests from your terminal.

## Installation

Install the CLI globally from npm:

```bash
npm install -g browsing-bee-cli
```

Then confirm it is available:

```bash
browsingbee --help
```

For local development from this repository:

```bash
npm install
npm link
```

## Authentication

Login with your BrowsingBee API key:

```bash
browsingbee login
```

You can also pass the API key directly for a one-liner login:

```bash
browsingbee login --apikey YOUR_API_KEY
```

The CLI stores your API key locally so future commands can use it.

## Commands

### Login

Authenticate the CLI:

```bash
browsingbee login
```

### Run a New Test

Create and run a browser test:

```bash
browsingbee run --name "Login smoke test" --url "https://example.com" --description "Verify the user can log in"
```

If `--name` or `--url` is missing, the CLI will ask for it interactively.

### Use Skill

Run an existing BrowsingBee skill or saved test by ID:

```bash
browsingbee use-skill --id 123
```

You can pass runtime variables as additional options. These are sent to BrowsingBee with the run request:

```bash
browsingbee use-skill --id 123 --email "user@example.com" --password "secret"
```

### Session Management

BrowsingBee supports session persistence, allowing you to save browser state (like login cookies) and reuse it in future runs.

#### Save a Session
To save the session after a successful run, use the `--save_session` flag:

```bash
browsingbee run --url "https://magicslides.app" --save_session
```

#### Use a Saved Session
To reuse a previously saved session for a specific domain, use the `--use_session` flag:

```bash
browsingbee run --url "https://magicslides.app" --use_session "magicslides.app"
```

#### Manage Sessions
List all active sessions or clear them:

```bash
# List all saved sessions
browsingbee sessions

# Clear a specific session
browsingbee sessions --clear "magicslides.app"
```

### List Tests

List all tests available for your account:

```bash
browsingbee list
```

### Test History

View previous runs for a test:

```bash
browsingbee history 123
```

### Credits

Check your current plan and remaining credits:

```bash
browsingbee credits
```

### Status

Check the status of a run:

```bash
browsingbee status RUN_ID
```

### Interactive Mode

Select and run tests from an interactive terminal menu. You can also configure session options within the interactive menu:

```bash
browsingbee interactive
```

## Publishing

Before publishing, make sure the CLI points to the production BrowsingBee backend instead of a local development server.

Check what npm will include:

```bash
npm pack --dry-run
```

Publish to npm:

```bash
npm publish
```

For future releases, bump the version first:

```bash
npm version patch
npm publish
```

## Requirements

- Node.js 18 or newer
- A BrowsingBee API key