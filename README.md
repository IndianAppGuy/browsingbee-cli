# BrowsingBee CLI

Accelerate web automation with Instant Research and Test Generation directly from your terminal.

## Installation

```bash
cd browsing-bee-cli
npm link
```

## Commands

### 1. Initialize
Setup the connection to the BrowsingBee backend.
```bash
browsingbee init
```

### 2. Research
Understand a website's structure before generating tests.
```bash
browsingbee research <url>
```

### 3. Generate
Transform a URL into executable test scenarios.
```bash
browsingbee generate <url> --description "Verify login works" --output scenario.json
```

### 4. Run
Execute a generated test locally via the backend.
```bash
browsingbee run scenario.json
```

## Architecture

The CLI acts as a bridge to the BrowsingBee Backend which uses OpenAI and ScrapingBee to analyze and automate web interactions.
