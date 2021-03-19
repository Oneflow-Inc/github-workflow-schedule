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
        per_page: 20
    }).then(
        r => {
            Promise.all(
                r.data.workflow_runs.map(async wr => {
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
                            isPrUpdatedAndOpen = false
                            isLatestCommitInBranch = false

                            await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
                                owner: owner,
                                repo: repo,
                                branch: wr.head_branch
                            }).then(r => {
                                if (r.data.commit.sha == wr.head_commit.id) {
                                    isLatestCommitInBranch = true
                                } else {
                                    console.log(`[outdated commit: ${wr.head_branch}]`, `[latest: ${r.data.commit.sha}]`, `[head: ${wr.head_commit.id}]`, wr.html_url)
                                }
                            })
                                .catch(e => {
                                    isLatestCommitInBranch = true
                                    console.log(`[absent: ${wr.head_branch}]`, wr.html_url)
                                })
                            await Promise.all(
                                wr.pull_requests.map(async pr => {
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
                                                    console.log("[pr updated]", wr.html_url)
                                                    isPrUpdatedAndOpen = true
                                                } else {
                                                    console.log("[pr closed]", wr.html_url)
                                                }
                                            })
                                        } else {
                                            console.log("[pr behind base]", wr.html_url)
                                        }
                                    })
                                })
                            )

                            shouldReRun = isPrUpdatedAndOpen && isNetworkFail && isLatestCommitInBranch
                            if (shouldReRun) {
                                console.log("[re-run]", wr.html_url)
                                await octokit.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun', {
                                    owner: owner,
                                    repo: repo,
                                    run_id: wr.id
                                }).then(r => console.log(console.log(`[rerun: ${r.status}]`, wr.html_url)))
                            }
                            if (shaSeenBefore.has(wr.head_sha)) {
                                console.log("[duplicated]", wr.html_url)
                            }
                            if (['in_progress', 'queued'].includes(wr.status)) {
                                commitOutdated = isLatestCommitInBranch == false
                                duplicated = shaSeenBefore.has(wr.head_sha)
                                noPrReleated = wr.pull_requests.length == 0
                                if (commitOutdated || duplicated || noPrReleated) {
                                    reasons = [
                                        (commitOutdated ? "not latest commit" : ""),
                                        (duplicated ? "duplicated commit" : ""),
                                        (noPrReleated ? "no PR releated" : ""),
                                    ]
                                    reason = reasons.filter(x => x != "").join(", ")
                                    console.log("[cancel]", `[${reason}]`, wr.html_url)
                                    await octokit.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel', {
                                        owner: owner,
                                        repo: repo,
                                        run_id: wr.id
                                    })
                                }
                            } else {
                                // await Promise.all(
                                //     wr.pull_requests.map(async pr => {
                                //         await octokit.request('DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', {
                                //             owner: owner,
                                //             repo: repo,
                                //             pull_number: pr.number,
                                //             reviewers: [
                                //                 'oneflow-ci-bot'
                                //             ]
                                //         }).then(r => console.log("[remove reviewer]", wr.html_url))
                                //     })
                                // )
                            }
                            shaSeenBefore.add(wr.head_sha)
                        }
                    )
                }
                )
            )
        }
    )
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
