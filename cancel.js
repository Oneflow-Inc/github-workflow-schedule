const { Octokit } = require('@octokit/core');
token = process.env.CI_PERSONAL_ACCESS_TOKEN
if (!token) {
    const core = require('@actions/core');
    core.setFailed("required CI_PERSONAL_ACCESS_TOKEN");
    process.exit(1)
}
const octokit = new Octokit({ auth: "2e62bb1ceb7950286408a43daef6c529e2988eed" });
const owner = 'Oneflow-Inc';
const repo = 'oneflow';

async function reRun() {
    test_workflow_id = await octokit.request('GET /repos/{owner}/{repo}/actions/workflows', {
        owner: owner,
        repo: repo
    }).then(r => r.data.workflows.filter(x => x.name == 'Build and Test CI')[0].id)
    await octokit.request('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs', {
        owner: owner,
        repo: repo,
        workflow_id: test_workflow_id,
        per_page: 100
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
                if (wr.pull_requests.length == 0) {
                    console.log("[to ancel]", `[status: ${wr.status}]`, wr.html_url)
                }
                if (wr.pull_requests.length == 0 && wr.status != 'completed') {
                    console.log("[cancel]", wr.html_url)
                    await octokit.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel', {
                        owner: owner,
                        repo: repo,
                        run_id: wr.id
                    })
                } else {
                    wr.pull_requests.map(async pr => {
                        base_sha = pr.base.sha
                        await octokit.request('GET /repos/{owner}/{repo}/compare/{base}...{head}', {
                            owner: owner,
                            repo: repo,
                            base: base_sha,
                            head: wr.head_sha
                        }).then(async r => {
                            pr_detail = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
                                owner: owner,
                                repo: repo,
                                pull_number: pr.number
                            }).then(async r => {
                                if (r.data.state == "open") {
                                    isUpdatedPr = true
                                } else {
                                    console.log("[cancel]", `https://github.com/Oneflow-Inc/oneflow/pull/4453/${pr.number}`)
                                    await octokit.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel', {
                                        owner: owner,
                                        repo: repo,
                                        run_id: wr.id
                                    })
                                }
                            })
                        })
                    })
                }

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
    const core = require('@actions/core');
    core.setFailed(e);
})
