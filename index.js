#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';
import ora from 'ora';
import dotenv from 'dotenv';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventSource } from 'eventsource';

dotenv.config();
const envPath = path.join(process.cwd(), '.env');
const program = new Command();

/**
 * Connects to the backend live stream and handles incoming updates.
 */
function listenToLiveUpdates(backendUrl, testId, options = {}) {
    const { verbose = false } = options;
    const outputDir = path.join(options.baseOutputDir || './screenshots', testId);

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const sseUrl = `${backendUrl}/api/test-stream/${testId}`;

    // Support for both native fetch/SSE and the polyfill
    const ES = (typeof globalThis.EventSource !== 'undefined') ? globalThis.EventSource : EventSource;
    const es = new ES(sseUrl);

    console.log(chalk.blue(`📡 Connecting to live stream: ${sseUrl}`));
    console.log(chalk.gray(`📂 Saving screenshots to: ${outputDir}`));

    es.onopen = () => {
        console.log(chalk.green('✅ SSE Connection established!'));
    };

    es.onmessage = (event) => {
        console.log(chalk.gray('📩 Received message:'), event.data);
        const data = JSON.parse(event.data);

        if (data.type === 'log') {
            const { message, status, timestamp } = data.log;
            const icon = status === 'success' ? chalk.green('✅') : (status === 'error' ? chalk.red('❌') : chalk.blue('ℹ️'));
            console.log(`${chalk.gray(`[${timestamp}]`)} ${icon} ${chalk.bold(status.toUpperCase())}: ${message}`);
        }

        if (data.type === 'screenshot') {
            const { stepId, url, local, tag } = data;

            // Smart Filtering:
            // - If verbose is true, save everything.
            // - Otherwise, ONLY save specific tags (assertion, error, final) or explicit 'highlight'
            // - We skip standard 'before'/'after' shots unless verbose is on.
            const isImportant = tag && ['assertion', 'error', 'final', 'highlight'].includes(tag);
            const shouldSave = verbose || isImportant;

            if (shouldSave) {
                if (url.startsWith('data:image/png;base64,')) {
                    const base64Data = url.replace(/^data:image\/png;base64,/, "");
                    const fileName = `step-${stepId}-${tag || (local ? 'before' : 'after')}.png`;
                    const filePath = path.join(outputDir, fileName);
                    fs.writeFileSync(filePath, base64Data, 'base64');
                    console.log(chalk.gray(`📸 Screenshot saved: ${outputDir}/${fileName}`));
                } else {
                    console.log(chalk.gray(`🌐 Remote Screenshot available: ${url}`));
                }
            } else if (url.startsWith('data:image/png;base64,')) {
                // If we skipped it, maybe just log a tiny debug message or nothing to reduce noise
                // console.log(chalk.gray(`⏭️  Skipped screenshot (verbose=false): step-${stepId}-${tag}`));
            }
        }

        if (data.type === 'completed') {
            es.close();
        }
    };

    es.onerror = (err) => {
        console.log(chalk.red(`❌ SSE Error: ${err.message || 'Connection failed'}`));
        es.close();
    };

    return es;
}

program
    .name('browsingbee')
    .description('Developer-centric tool for web automation, research and test generation')
    .version('1.0.0');

// browsingbee init
program
    .command('init')
    .description('Setup the connection to the BrowsingBee backend')
    .action(async () => {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'backendUrl',
                message: 'Enter the BrowsingBee Backend URL:',
                default: process.env.BACKEND_URL || 'http://localhost:3005'
            }
        ]);

        const spinner = ora('Verifying connection...').start();
        try {
            const response = await axios.get(`${answers.backendUrl}/test`, { timeout: 5000 });
            if (response.status === 200) {
                spinner.succeed(chalk.green('Connection verified!'));

                const envContent = `BACKEND_URL=${answers.backendUrl}\n`;
                fs.writeFileSync(envPath, envContent);

                console.log(chalk.blue(`Configuration saved to ${envPath}`));
            } else {
                spinner.fail(chalk.red(`Backend returned status ${response.status}`));
            }
        } catch (error) {
            spinner.fail(chalk.red(`Could not connect to backend: ${error.message}`));
        }
    });

// browsingbee research <url>
program
    .command('research')
    .description('Understand a website\'s structure')
    .argument('<url>', 'URL to research')
    .option('-o, --output <file>', 'Save output to a JSON file')
    .action(async (url, options) => {
        const backendUrl = process.env.BACKEND_URL;
        if (!backendUrl) {
            console.log(chalk.yellow('Please run "browsingbee init" first.'));
            return;
        }

        const spinner = ora(`Researching ${url}...`).start();
        try {
            const response = await axios.post(`${backendUrl}/api/instant/research`, { url });
            spinner.succeed(chalk.green('Research complete!'));

            const data = response.data;

            console.log('\n' + chalk.bold.cyan('=== Research Summary ==='));
            console.log(chalk.bold('Domain Purpose:'), data.domainPurpose);

            console.log('\n' + chalk.bold('Key UI Elements:'));
            data.keyUIElements.forEach(item => console.log(` - ${item}`));

            console.log('\n' + chalk.bold('Functional Areas:'));
            data.functionalAreas.forEach(item => console.log(` - ${item}`));

            console.log('\n' + chalk.bold('AI Summary:'), data.summary);

            if (options.output) {
                fs.writeFileSync(options.output, JSON.stringify(data, null, 2));
                console.log(chalk.green(`\nReport saved to ${options.output}`));
            }
        } catch (error) {
            spinner.fail(chalk.red(`Research failed: ${error.message}`));
            if (error.response) {
                console.error(chalk.gray(JSON.stringify(error.response.data, null, 2)));
            }
        }
    });

// browsingbee generate <url>
program
    .command('generate')
    .description('Transform a URL into executable test scenarios')
    .argument('<url>', 'URL to generate tests for')
    .option('-d, --description <text>', 'Specific intent or description of the test')
    .option('-o, --output <file>', 'Output filename', 'scenario.json')
    .action(async (url, options) => {
        const backendUrl = process.env.BACKEND_URL;
        if (!backendUrl) {
            console.log(chalk.yellow('Please run "browsingbee init" first.'));
            return;
        }

        const spinner = ora(`Generating scenarios for ${url}...`).start();
        try {
            const response = await axios.post(`${backendUrl}/api/instant/generate`, {
                url,
                description: options.description
            });
            spinner.succeed(chalk.green('Generation complete!'));

            const data = response.data;
            const steps = data.steps || data.scenarios || [];

            fs.writeFileSync(options.output, JSON.stringify({ ...data, steps }, null, 2));

            console.log(chalk.bold.cyan('\nGenerated Steps:'));
            if (steps.length === 0) {
                console.log(chalk.yellow('No steps were generated.'));
            } else {
                steps.forEach((step, index) => {
                    let action = `${index + 1}. ${step.actionType}: `;
                    if (step.actionType === 'Click Element') action += step.details?.element || 'Unknown element';
                    else if (step.actionType === 'Fill Input') action += `${step.details?.description || 'field'} -> ${step.details?.value || 'value'}`;
                    else if (step.actionType === 'AI Visual Assertion') action += step.question;
                    else if (step.actionType === 'Delay') action += `${step.delayTime}ms`;
                    console.log(action);
                });
            }

            console.log(chalk.green(`\nScenario saved to ${options.output}`));
        } catch (error) {
            spinner.fail(chalk.red(`Generation failed: ${error.message}`));
            if (error.response) {
                console.error(chalk.gray(JSON.stringify(error.response.data, null, 2)));
            }
        }
    });

// browsingbee run <scenario-file>
program
    .command('run')
    .description('Execute a generated test scenario')
    .argument('<scenario-file>', 'Path to the JSON scenario file')
    .option('-v, --verbose', 'Save all intermediate screenshots (before/after steps)')
    .action(async (file, options) => {
        const backendUrl = process.env.BACKEND_URL;
        if (!backendUrl) {
            console.log(chalk.yellow('Please run "browsingbee init" first.'));
            return;
        }

        if (!fs.existsSync(file)) {
            console.log(chalk.red(`File not found: ${file}`));
            return;
        }

        const scenario = JSON.parse(fs.readFileSync(file, 'utf8'));
        const testId = `cli-${Date.now()}`;
        const spinner = ora('Initializing execution...').start();

        // Start listening to live updates
        const listener = listenToLiveUpdates(backendUrl, testId, {
            verbose: options.verbose
        });

        // Give SSE a moment to establish connection
        await new Promise(resolve => setTimeout(resolve, 1500));

        try {
            const payload = {
                startUrl: scenario.url,
                name: scenario.name || `CLI Run: ${scenario.url}`,
                steps: scenario.steps || scenario.scenarios || [],
                testId: testId,
                email: scenario.email || 'cli-user@example.com',
                runId: `run-${Date.now()}`
            };

            const response = await axios.post(`${backendUrl}/run-scenario`, payload, {
                timeout: 600000 // 10 minutes timeout for execution
            });
            spinner.succeed(chalk.green('Execution complete!'));

            if (response.data.tokenUsage) {
                console.log('\n' + chalk.bold.cyan('=== Token Usage ==='));
                console.log(`${chalk.bold('Total Tokens:')} ${response.data.tokenUsage.totalTokens}`);
                console.log(`${chalk.bold('Estimated Cost:')} $${response.data.tokenUsage.estimatedCost}`);
            }
        } catch (error) {
            spinner.fail(chalk.red(`Execution failed: ${error.message}`));
            listener.close();
        }
    });

program.parse();
