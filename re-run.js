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
const core = require('@actions/core');

async function reRun() {
    test_workflow_id = await octokit.request('GET /repos/{owner}/{repo}/actions/workflows', {
        owner: owner,
        repo: repo
    }).then(r => r.data.workflows.filter(x => x.name == 'Build and Test CI')[0].id)
    await octokit.request('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs', {
        owner: owner,
        repo: repo,
        workflow_id: test_workflow_id,
        per_page: 50
    }).then(r => r.data.workflow_runs.map(async wr => {
        await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', {
            owner: owner,
            repo: repo,
            run_id: wr.id
        }).then(
            async r => {
                isNetworkFail = false
                r.data.jobs.map(
                    j => j.steps.map(
                        s => {
                            if (s.name.includes("checkout") || s.name.includes("Set up job")) {
                                if (s.status == 'completed' && s.conclusion == 'failure') {
                                    isNetworkFail = true
                                }
                            }
                        }
                    )
                )
                var shaSeenBefore = new Set();
                isUpdatedPr = false
                isLatestCommitInPr = false
                if (wr.pull_requests.length == 0) {
                    core.setOutput("[no pr related]", wr.html_url)
                } else {
                    wr.pull_requests.map(async pr => {
                        if (pr.head.sha == wr.head_commit.id) {
                            isLatestCommitInPr = true
                        }
                        base_sha = pr.base.sha
                        await octokit.request('GET /repos/{owner}/{repo}/compare/{base}...{head}', {
                            owner: owner,
                            repo: repo,
                            base: base_sha,
                            head: wr.head_sha
                        }).then(async r => {
                            if (r.data.behind_by == 0) {
                                await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
                                    owner: owner,
                                    repo: repo,
                                    pull_number: pr.number
                                }).then(r => {
                                    if (r.data.state == "open") {
                                        isUpdatedPr = true
                                    } else {
                                        core.setOutput("[pr closed]", wr.html_url)
                                    }
                                })
                            } else {
                                core.setOutput("[pr behind base]", wr.html_url)
                            }
                        })
                    })
                }

                shouldReRun = isUpdatedPr && isNetworkFail && isLatestCommitInPr
                if (shouldReRun) {
                    core.setOutput("[re-run]", wr.html_url)
                    await octokit.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun', {
                        owner: owner,
                        repo: repo,
                        run_id: wr.id
                    }).then(r => console.log(console.log(`[rerun: ${r.status}]`, wr.html_url)))
                }

                if (isLatestCommitInPr == false || shaSeenBefore.has(wr.head_sha) || wr.pull_requests.length == 0 || isUpdatedPr == false) {
                    if (['in_progress', 'queued'].includes(wr.status)) {
                        core.setOutput("[cancel]", wr.html_url)
                        await octokit.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel', {
                            owner: owner,
                            repo: repo,
                            run_id: wr.id
                        })
                        wr.pull_requests.map(async pr => {
                            await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', {
                                owner: owner,
                                repo: repo,
                                pull_number: pr.number,
                                reviewers: [
                                    'oneflow-ci-bot'
                                ]
                            })
                        })
                    }

                }
                shaSeenBefore.add(wr.head_sha)
            }
        )
    }))
}


async function start() {
    const timeout_minutes = 2
    const sleep = require('util').promisify(setTimeout)
    while (true) {
        await reRun().catch(e => console.log(e));
        const timeout = 60 * timeout_minutes;
        await sleep(timeout * 1000)
        console.log('timeout', timeout, 's')
    }
}

reRun().catch(e => {
    core.setFailed(e);
})
