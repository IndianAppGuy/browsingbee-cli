#!/usr/bin/env node

import { Command } from "commander";
import inquirer from "inquirer";
import axios from "axios";
import Conf from "conf";
import chalk from "chalk";
import ora from "ora";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const esModule = require("eventsource");
const EventSource = esModule.EventSource || esModule;

const program = new Command();
const config = new Conf({ projectName: "browsing-bee-cli" });

const BACKEND_URL = "http://localhost:3005"; // Default local development URL

function normalizeLegacyRunTestArgv(argv) {
    return argv.map((arg) => {
        if (arg === "-id") return "--id";
        if (arg.startsWith("-id=")) return `--id=${arg.slice(4)}`;
        return arg;
    });
}

function extractRuntimeVariablesFromRawArgs(rawArgs, commandName, reservedKeys = new Set()) {
    const commandIndex = rawArgs.indexOf(commandName);
    if (commandIndex === -1) {
        return {};
    }

    const commandArgs = rawArgs.slice(commandIndex + 1);
    const runtimeVariables = {};

    for (let i = 0; i < commandArgs.length; i++) {
        const arg = commandArgs[i];
        if (!arg.startsWith("--") || arg === "--") {
            continue;
        }

        const optionBody = arg.slice(2);
        if (!optionBody) {
            continue;
        }

        let key;
        let value;

        if (optionBody.includes("=")) {
            const splitIndex = optionBody.indexOf("=");
            key = optionBody.slice(0, splitIndex);
            value = optionBody.slice(splitIndex + 1);
        } else {
            key = optionBody;
            const nextValue = commandArgs[i + 1];
            if (nextValue && !nextValue.startsWith("-")) {
                value = nextValue;
                i += 1;
            } else {
                value = "true";
            }
        }

        if (!key || reservedKeys.has(key)) {
            continue;
        }

        runtimeVariables[key] = value;
    }

    return runtimeVariables;
}

program
    .name("browsingbee")
    .description("CLI for BrowsingBee - Automate your browser tasks")
    .version("1.0.0");

program
    .command("login")
    .description("Login with your API Key")
    .option("--api_key <key>", "Your BrowsingBee API Key")
    .action(async (options) => {
        let apiKey = options.api_key;

        if (!apiKey) {
            const answers = await inquirer.prompt([
                {
                    type: "password",
                    name: "apiKey",
                    message: "Enter your BrowsingBee API Key:",
                    validate: (input) => (input ? true : "API Key is required"),
                },
            ]);
            apiKey = answers.apiKey;
        }

        const spinner = ora("Authenticating...").start();

        try {
            const response = await axios.post(`${BACKEND_URL}/api/cli/login`, {
                api_key: apiKey,
            });

            if (response.data.success) {
                config.set("api_key", apiKey);
                config.set("user", response.data.user);
                spinner.succeed(chalk.green(`Successfully logged in as ${response.data.user.email}!`));
            } else {
                spinner.fail(chalk.red("Authentication failed. Invalid API Key."));
            }
        } catch (error) {
            spinner.fail(chalk.red("Error connecting to server."));
            if (error.response) {
                console.error(chalk.red(error.response.data.error || error.message));
            } else {
                console.error(chalk.red(error.message));
            }
        }
    });

program
    .command("run")
    .description("Run a browser test")
    .option("--name <name>", "Name of the test")
    .option("--url <url>", "Starting URL for the test")
    .option("-d, --description <text>", "Description of the test task (enables AI step generation)")
    .action(async (options) => {
        const apiKey = config.get("api_key");

        if (!apiKey) {
            console.log(chalk.red("You are not logged in. Please run 'browsingbee login' first."));
            return;
        }

        let { name, url, description } = options;

        if (!name || !url) {
            const answers = await inquirer.prompt([
                {
                    type: "input",
                    name: "name",
                    message: "Test Name:",
                    when: !name,
                    validate: (input) => (input ? true : "Test Name is required"),
                },
                {
                    type: "input",
                    name: "url",
                    message: "Start URL:",
                    when: !url,
                    validate: (input) => (input ? true : "URL is required"),
                },
            ]);
            name = name || answers.name;
            url = url || answers.url;
        }

        const spinner = ora(`Initializing test "${name}"...`).start();

        try {
            const response = await axios.post(`${BACKEND_URL}/api/cli/run-test`, {
                api_key: apiKey,
                name,
                url,
                description, // Pass description to the backend
            });

            if (response.data.success) {
                spinner.succeed(chalk.green("Test initialized successfully!"));
                const { testId } = response.data;

                console.log(chalk.blue(`\nStreaming logs for Test ID: ${testId}\n`));

                const eventSource = new EventSource(`${BACKEND_URL}/api/test-stream/${testId}`);

                eventSource.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);

                        if (data.type === 'connected') {
                            console.log(chalk.gray("Connected to log stream..."));
                        } else if (data.type === 'completed') {
                            console.log(chalk.bold.green(`\nTest execution finished!`));
                            console.log(chalk.bold.green(`View results at: https://browsingbee.com/b/${testId}`));
                            eventSource.close();
                            // Optional: exit process if this is the only thing running
                            process.exit(0);
                        } else if (data.message) {
                            // Format status
                            let statusColor = chalk.white;
                            if (data.status === 'success') statusColor = chalk.green;
                            else if (data.status === 'error') statusColor = chalk.red;
                            else if (data.status === 'info') statusColor = chalk.blue;
                            else if (data.status === 'warning') statusColor = chalk.yellow;

                            console.log(`${chalk.gray(`[${data.timestamp || new Date().toLocaleTimeString()}]`)} ${statusColor(data.status?.toUpperCase() || 'INFO')}: ${data.message}`);
                        }
                    } catch (e) {
                        // console.log("Raw:", event.data);
                    }
                };

                eventSource.onerror = (err) => {
                    // console.error("Stream disrupted.");
                    // Do not exit on error immediately as it might be temporary or connection drop
                };
            } else {
                spinner.fail(chalk.red("Failed to start test."));
            }
        } catch (error) {
            spinner.fail(chalk.red("Error executing test."));
            if (error.response) {
                console.error(chalk.red(error.response.data.error || error.message));
            } else {
                console.error(chalk.red(error.message));
            }
        }
    });

program
    .command("use-skill")
    .description("Run an existing test by ID")
    .requiredOption("--id <id>", "ID of the existing test to run")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (options, command) => {
        const apiKey = config.get("api_key");

        if (!apiKey) {
            console.log(chalk.red("You are not logged in. Please run 'browsingbee login' first."));
            return;
        }

        const testId = String(options.id || "").trim();
        if (!testId) {
            console.log(chalk.red("Test ID is required. Example: browsingbee use-skill --id=6"));
            return;
        }

        const runtimeVariables = extractRuntimeVariablesFromRawArgs(
            command.parent.rawArgs,
            "use-skill",
            new Set(["id"])
        );

        const spinner = ora(`Initializing test "${testId}"...`).start();

        try {
            const response = await axios.post(`${BACKEND_URL}/api/cli/run-test`, {
                api_key: apiKey,
                testId,
                runtimeVariables,
            });

            if (response.data.success) {
                spinner.succeed(chalk.green("Test initialized successfully!"));
                const responseTestId = response.data.testId;

                if (Object.keys(runtimeVariables).length > 0) {
                    console.log(chalk.gray(`Using runtime variables: ${Object.keys(runtimeVariables).join(", ")}`));
                }
                console.log(chalk.blue(`\nStreaming logs for Test ID: ${responseTestId}\n`));

                const eventSource = new EventSource(`${BACKEND_URL}/api/test-stream/${responseTestId}`);

                eventSource.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);

                        if (data.type === 'connected') {
                            console.log(chalk.gray("Connected to log stream..."));
                        } else if (data.type === 'completed') {
                            console.log(chalk.bold.green(`\nTest execution finished!`));
                            console.log(chalk.bold.green(`View results at: https://browsingbee.com/b/${responseTestId}`));
                            eventSource.close();
                            process.exit(0);
                        } else if (data.message) {
                            let statusColor = chalk.white;
                            if (data.status === 'success') statusColor = chalk.green;
                            else if (data.status === 'error') statusColor = chalk.red;
                            else if (data.status === 'info') statusColor = chalk.blue;
                            else if (data.status === 'warning') statusColor = chalk.yellow;

                            console.log(`${chalk.gray(`[${data.timestamp || new Date().toLocaleTimeString()}]`)} ${statusColor(data.status?.toUpperCase() || 'INFO')}: ${data.message}`);
                        }
                    } catch (e) {
                        // no-op
                    }
                };

                eventSource.onerror = () => {
                    // Do not exit on stream disruption
                };
            } else {
                spinner.fail(chalk.red("Failed to start test."));
            }
        } catch (error) {
            spinner.fail(chalk.red("Error executing test."));
            if (error.response) {
                console.error(chalk.red(error.response.data.error || error.message));
            } else {
                console.error(chalk.red(error.message));
            }
        }
    });

program
    .command("list")
    .description("List all tests")
    .action(async () => {
        const apiKey = config.get("api_key");
        if (!apiKey) {
            console.log(chalk.red("Please login first."));
            return;
        }

        const spinner = ora("Fetching tests...").start();
        try {
            const { data } = await axios.get(`${BACKEND_URL}/api/cli/tests`, {
                headers: { "x-api-key": apiKey }
            });
            spinner.stop();

            if (data.success) {
                if (data.tests.length === 0) {
                    console.log(chalk.yellow("No tests found."));
                    return;
                }
                console.table(data.tests.map(t => ({
                    ID: t.id,
                    Name: t.name,
                    Status: t.status || "N/A",
                    "Latest Run": t.latest_run || "N/A",
                    Created: new Date(t.created_at).toLocaleDateString()
                })));
            }
        } catch (error) {
            spinner.fail(chalk.red("Failed to fetch tests"));
            console.error(error.message);
        }
    });

program
    .command("history <testId>")
    .description("Get test history")
    .action(async (testId) => {
        const apiKey = config.get("api_key");
        if (!apiKey) return console.log(chalk.red("Please login first."));

        const spinner = ora("Fetching history...").start();
        try {
            const { data } = await axios.get(`${BACKEND_URL}/api/cli/history/${testId}`, {
                headers: { "x-api-key": apiKey }
            });
            spinner.stop();

            if (data.history && data.history.length > 0) {
                console.table(data.history);
            } else {
                console.log(chalk.yellow("No history available for this test."));
            }
        } catch (error) {
            spinner.fail(chalk.red("Failed to fetch history"));
        }
    });

program
    .command("credits")
    .description("Check your credits")
    .action(async () => {
        const apiKey = config.get("api_key");
        if (!apiKey) return console.log(chalk.red("Please login first."));

        const spinner = ora("Fetching credits...").start();
        try {
            const { data } = await axios.get(`${BACKEND_URL}/api/cli/credits`, {
                headers: { "x-api-key": apiKey }
            });
            spinner.stop();

            if (data.success) {
                const c = data.credits;
                console.log(chalk.bold(`Plan: ${chalk.cyan(c.plan)}`));
                console.log(`Total: ${c.total}`);
                console.log(`Used: ${chalk.yellow(c.used)}`);
                console.log(`Remaining: ${chalk.green(c.remaining)}`);
            }
        } catch (error) {
            spinner.fail(chalk.red("Failed to fetch credits"));
        }
    });

program
    .command("status <runId>")
    .description("Check run status")
    .action(async (runId) => {
        const apiKey = config.get("api_key");
        if (!apiKey) return console.log(chalk.red("Please login first."));

        try {
            const { data } = await axios.get(`${BACKEND_URL}/api/cli/status/${runId}`, {
                headers: { "x-api-key": apiKey }
            });

            if (data.success) {
                console.log(`Status: ${chalk.bold(data.status)}`);
                if (data.screenshot) {
                    console.log(`Screenshot: ${data.screenshot}`);
                }
                if (data.logs) {
                    console.log(chalk.bold("\nLatest Logs:"));
                    data.logs.slice(-5).forEach(log => {
                        console.log(`[${log.status || 'info'}] ${log.message}`);
                    });
                }
            }
        } catch (error) {
            console.error(chalk.red("Failed to fetch status"));
        }
    });

program
    .command("interactive")
    .description("Interactive mode")
    .action(async () => {
        const apiKey = config.get("api_key");
        if (!apiKey) return console.log(chalk.red("Please login first."));

        // 1. Fetch Tests
        const spinner = ora("Fetching tests...").start();
        let tests = [];
        try {
            const res = await axios.get(`${BACKEND_URL}/api/cli/tests`, { headers: { "x-api-key": apiKey } });
            tests = res.data.tests;
            spinner.stop();
        } catch (err) {
            spinner.fail("Failed to load tests.");
            return;
        }

        if (tests.length === 0) {
            console.log(chalk.yellow("No tests to select."));
            return;
        }

        // 2. Select Test
        const { selectedTest } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedTest',
            message: 'Select a test:',
            choices: tests.map(t => ({ name: `${t.name} (ID: ${t.id})`, value: t }))
        }]);

        // 3. Select Action
        const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: `Action for "${selectedTest.name}":`,
            choices: [
                { name: 'Run Test', value: 'run' },
                { name: 'Edit & Run', value: 'edit_run' },
                { name: 'View History', value: 'history' },
                { name: 'Back/Exit', value: 'exit' }
            ]
        }]);

        if (action === 'run' || action === 'edit_run') {
            let runPayload = {
                api_key: apiKey,
                name: selectedTest.name, // Will be ignored by backend effectively if testId is present, but kept for schema validation if strictly needed
                url: selectedTest.url || "https://google.com",
                testId: selectedTest.id // PASS TEST ID FOR RE-RUN
            };

            if (action === 'edit_run') {
                const editAnswers = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'url',
                        message: 'Enter URL (leave blank to keep current):',
                        default: selectedTest.url
                    },
                    {
                        type: 'input',
                        name: 'description',
                        message: 'Enter Description to (re)generate steps (leave blank to keep current steps):',
                    }
                ]);

                if (editAnswers.url) runPayload.url = editAnswers.url;
                if (editAnswers.description) runPayload.description = editAnswers.description;
            }

            // Reuse the run logic manually or call separate function. 
            // For simplicity, calling the API directly here.
            const spinner = ora(`Initializing test "${selectedTest.name}"...`).start();
            try {
                const response = await axios.post(`${BACKEND_URL}/api/cli/run-test`, runPayload);

                if (response.data.success) {
                    spinner.succeed(chalk.green("Test initialized!"));
                    const { testId } = response.data;
                    console.log(chalk.blue(`Streaming logs for Test ID: ${testId}`));

                    const eventSource = new EventSource(`${BACKEND_URL}/api/test-stream/${testId}`);
                    eventSource.onmessage = (event) => {
                        try {
                            const d = JSON.parse(event.data);
                            if (d.message) console.log(`[${d.status}] ${d.message}`);
                        } catch (e) { }
                    };
                    console.log(chalk.bold.green(`\nTest completed! View results at: https://browsingbee.com/b/${testId}`));
                }
            } catch (err) {
                spinner.fail("Failed to run test.");
            }
        } else if (action === 'history') {
            // Call history logic
            const { data } = await axios.get(`${BACKEND_URL}/api/cli/history/${selectedTest.id}`, {
                headers: { "x-api-key": apiKey }
            });
            console.table(data.history);
        }
    });

program.parse(normalizeLegacyRunTestArgv(process.argv));
