const { Octokit } = require('@octokit/core');
token = process.env.GITHUB_RUNNER_TOKEN
if (!token) {
    const core = require('@actions/core');
    core.setFailed("required GITHUB_RUNNER_TOKEN");
    process.exit(1)
}
const octokit = new Octokit({ auth: token });
const owner = 'Oneflow-Inc';
const repo = 'oneflow';

async function runners() {
    await octokit.request('GET /orgs/{org}/actions/runners', {
        org: owner
    }).then(r => r.data.runners.map(runner => console.log(runner)))
}

runners()
