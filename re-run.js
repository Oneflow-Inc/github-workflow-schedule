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
        per_page: 10
    }).then(r => r.data.workflow_runs.map(async wr => {
        await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', {
            owner: owner,
            repo: repo,
            run_id: wr.id
        }).then(
            async r => {
                shouldReRun = false
                r.data.jobs.map(
                    j => j.steps.map(
                        async s => {
                            if (s.name.includes("checkout") || s.name.includes("Set up job")) {
                                if (s.status == 'completed' && s.conclusion == 'failure') {
                                    console.log(s)
                                    shouldReRun = true
                                }
                            }
                        }
                    )
                )
                if (shouldReRun) {
                    await octokit.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun', {
                        owner: owner,
                        repo: repo,
                        run_id: wr.id
                    }).then(r => console.log("rerun", r.status))
                }
            }
        )
    }))
}
listAll()
