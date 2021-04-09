const { Octokit } = require('@octokit/core');
token = process.env.CI_PERSONAL_ACCESS_TOKEN
if (!token) {
    const core = require('@actions/core');
    core.setFailed("required CI_PERSONAL_ACCESS_TOKEN");
    process.exit(1)
}
const octokit = new Octokit({ auth: token });
const core = require('@actions/core');

async function reRun(owner, repo) {
    test_workflow_id = await octokit.request('GET /repos/{owner}/{repo}/actions/workflows', {
        owner: owner,
        repo: repo
    }).then(r => r.data.workflows.filter(x => x.name == 'Build and Test CI')[0].id)
    await octokit.request('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs', {
        owner: owner,
        repo: repo,
        workflow_id: test_workflow_id,
        per_page: 30,
    }).then(
        r => {
            shaSeenBefore = new Set()
            r.data.workflow_runs.forEach(
                async wr => {
                    const isShaSeenBefore = shaSeenBefore.has(wr.head_sha)
                    shaSeenBefore.add(wr.head_sha)
                    console.log("[processing]", wr.html_url)
                    const isNetworkFail = await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', {
                        owner: owner,
                        repo: repo,
                        run_id: wr.id
                    }).then(
                        r => r.data.jobs.map(
                            j => j.steps.map(
                                s => ((s.name.includes("checkout") || s.name == 'Set up job') && s.conclusion == 'failure')
                            ).filter(x => x == true).length > 0
                        ).filter(x => x == true).length > 0
                    )
                    const isLatestCommitInBranch =
                        await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
                            owner: wr.head_repository.owner.login,
                            repo: wr.head_repository.name,
                            branch: wr.head_branch
                        }).then(r => {
                            if (r.data.commit.sha == wr.head_commit.id) {
                                return true
                            } else {
                                console.log(`[outdated commit: ${wr.head_branch}]`, `[latest: ${r.data.commit.sha}]`, `[head: ${wr.head_commit.id}]`, wr.html_url)
                                return false
                            }
                        }).catch(e => true)


                    const isPrUpdatedAndOpen = await wr.pull_requests.reduce(async (acc, pr) => {
                        base_sha = pr.base.sha
                        return await octokit.request('GET /repos/{owner}/{repo}/compare/{base}...{head}', {
                            owner: owner,
                            repo: repo,
                            base: base_sha,
                            head: wr.head_sha
                        }).then(async r => {
                            isPrOpen = false
                            if (r.data.behind_by == 0) {
                                isPrOpen = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
                                    owner: owner,
                                    repo: repo,
                                    pull_number: pr.number
                                }).then(r => r.data.state == "open")
                            } else {
                                console.log("[pr behind base]", wr.html_url)
                            }
                            return (isPrOpen && r.data.behind_by == 0) || acc
                        })
                    }, false)

                    shouldReRun = isPrUpdatedAndOpen && isNetworkFail && isLatestCommitInBranch
                    if (isShaSeenBefore) {
                        console.log("[duplicated]", wr.html_url)
                    }
                    if (['in_progress', 'queued'].includes(wr.status)) {
                        const noPrReleated = wr.pull_requests.length == 0 && wr.head_repository.owner.login == "Oneflow-Inc"
                        if (isLatestCommitInBranch == false || isShaSeenBefore || noPrReleated) {
                            reasons = [
                                (isLatestCommitInBranch == false ? "not latest commit" : ""),
                                (isShaSeenBefore ? "duplicated commit" : ""),
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
                        if (shouldReRun) {
                            console.log("[re-run]", wr.html_url)
                            await octokit.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun', {
                                owner: owner,
                                repo: repo,
                                run_id: wr.id
                            }).then(r => console.log(console.log(`[rerun: ${r.status}]`, wr.html_url)))
                                .catch(e => console.log("[re-run fail]", e))
                        }
                        await Promise.all(
                            wr.pull_requests.map(async pr => {
                                if (isPrUpdatedAndOpen) {
                                    console.log("[remove reviewer]", wr.html_url)
                                    await octokit.request('DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', {
                                        owner: owner,
                                        repo: repo,
                                        pull_number: pr.number,
                                        reviewers: [
                                            'oneflow-ci-bot'
                                        ]
                                    }).catch(e => console.log("[failed to add reviewer]", wr.html_url))
                                }
                            })
                        )
                    }
                    console.log({
                        id: wr.id,
                        isPrUpdatedAndOpen: isPrUpdatedAndOpen,
                        isNetworkFail: isNetworkFail,
                        isLatestCommitInBranch: isLatestCommitInBranch,
                        relatedPRSize: wr.pull_requests.length,
                        isShaSeenBefore: isShaSeenBefore,
                        url: wr.html_url,
                        head_repo: `${wr.head_repository.owner.login}/${wr.head_repository.name}`
                    })
                    return shaSeenBefore
                }
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
const owner = 'Oneflow-Inc';
reRun(owner, 'oneflow').catch(e => {
    core.setFailed(e);
})
reRun(owner, 'oneflow_cambricon').catch(e => {
    core.setFailed(e);
})
