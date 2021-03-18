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

async function listAll() {
    test_workflow_id = await octokit.request('GET /repos/{owner}/{repo}/actions/workflows', {
        owner: owner,
        repo: repo
    }).then(r => r.data.workflows.filter(x => x.name == 'Build and Test CI')[0].id)
    await octokit.request('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs', {
        owner: owner,
        repo: repo,
        workflow_id: test_workflow_id,
        status: "failure",
        per_page: 20
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
                isUpdatedPr = false
                wr.pull_requests.map(async pr => {
                    base_sha = pr.base.sha
                    await octokit.request('GET /repos/{owner}/{repo}/compare/{base}...{head}', {
                        owner: owner,
                        repo: repo,
                        base: base_sha,
                        head: wr.head_sha
                    }).then(async r => {
                        if (r.data.behind_by == 0) {
                            pr_detail = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
                                owner: owner,
                                repo: repo,
                                pull_number: pr.number
                            }).then(r => {
                                if (r.data.state == "open") {
                                    isUpdatedPr = true
                                }
                            })
                        }
                    })
                })
                shouldReRun = isUpdatedPr && isNetworkFail
                if (shouldReRun) {
                    console.log("[re-run]", wr.html_url)
                    await octokit.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun', {
                        owner: owner,
                        repo: repo,
                        run_id: wr.id
                    }).then(r => console.log("rerun", r.status))
                } else {
                    console.log("[ok]", wr.html_url)
                }
            }
        )
    }))
}


async function start() {
    const timeout_minutes = 2
    const sleep = require('util').promisify(setTimeout)
    while (true) {
        await listAll().catch(e => console.log(e));
        const timeout = 60 * timeout_minutes;
        await sleep(timeout * 1000)
        console.log('timeout', timeout, 's')
    }
}

start()
