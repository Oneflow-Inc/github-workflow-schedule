const { Octokit } = require('@octokit/core');
token = process.env.CI_PERSONAL_ACCESS_TOKEN
if (!token) {
    const core = require('@actions/core');
    core.setFailed("required CI_PERSONAL_ACCESS_TOKEN");
    process.exit(1)
}
const octokit = new Octokit({ auth: token });
const owner = 'Oneflow-Inc';
const repo = 'oneflow';
async function requestBot() {
    pull_number = 4295
    await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', {
        owner: owner,
        repo: repo,
        pull_number: pull_number
    }).then(r => console.log(r.data.users))
    await octokit.request('DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', {
        owner: owner,
        repo: repo,
        pull_number: pull_number,
        reviewers: [
            'oneflow-ci-bot'
        ]
    }).then(r => console.log("[remove]", r.status))
    await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', {
        owner: owner,
        repo: repo,
        pull_number: pull_number,
        reviewers: [
            'oneflow-ci-bot'
        ]
    }).then(r => console.log(r.status, r.data.html_url))
}
requestBot()
