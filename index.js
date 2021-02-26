const { Octokit } = require("@octokit/core");
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const owner = 'Oneflow-Inc';
const repo = 'oneflow';
const has_queued_jobs = async function () {
    runs = await octokit.request('GET /repos/{owner}/{repo}/actions/runs', {
        owner: owner,
        repo: repo,
        status: "in_progress"
    })
        .then(r =>
            r.data.workflow_runs
        )
    promises = runs.map(async wr => {
        wr.pull_requests.map(pr => console.log(pr.url))
        const r = await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', {
            owner: owner,
            repo: repo,
            run_id: wr.id
        });
        return r.data.jobs;
    })
    jobs_list = await Promise.all(promises)
    num_queued_jobs = jobs_list
        .map(jobs => {
            queued_jobs = jobs
                .filter(j => j.status == "queued")
            if (queued_jobs.length != 0) {
                queued_jobs.map(j => console.log(j.name, "||", j.status))
            }
            return queued_jobs.length
        }).reduce((a, b) => a + b, 0)
    return num_queued_jobs > 0
}

const num_in_progress_runs = async function () {
    workflow_runs = await octokit.request('GET /repos/{owner}/{repo}/actions/runs', {
        owner: owner,
        repo: repo
    })
        .then(r =>
            r.data.workflow_runs
        )
    promises = workflow_runs.map(async wr => {
        const r = await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', {
            owner: owner,
            repo: repo,
            run_id: wr.id
        });
        jobs = r.data.jobs.filter(j =>
            (["CPU", "CUDA", "XLA"].includes(j.name) || j.name == "CUDA, XLA, CPU")
            && j.status == "in_progress")
        jobs.map(j => console.log(wr.id, "*", wr.name, "*", j.name, "*", j.status))
        return jobs;
    })
    running_jobs_list = await Promise.all(promises)
    return running_jobs_list.filter(jobs => jobs.length > 0).length
}

const has_gpu_runner = async function () {
    free_runners = await octokit.request('GET /repos/{owner}/{repo}/actions/runners', {
        owner: owner,
        repo: repo
    }).then(r =>
        r.data.runners.filter(runner => runner.busy == false
            && runner.labels.filter(l => l.name == "gpu").length > 0))

    return free_runners.length > 0
}

const sleep = require('util').promisify(setTimeout)

async function start() {
    let i = 0;
    while (i < 1000) {
        console.log("trying", i + 1, "/", 1000)
        let num = await num_in_progress_runs()
        let max_num_parallel = 1
        console.log("in-progress runs:", num, ",", "max parallel runs:", max_num_parallel)
        if (num <= max_num_parallel) {
            return; // success
        }
        timeout = 60
        await sleep(timeout * 1000)
        console.log("timeout", timeout, "s")
        i++;
    }
    throw 'No GPU runner available for now';
}

start().catch(error => {
    const core = require('@actions/core');
    core.setFailed(error.message);
})
