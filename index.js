const { Octokit } = require("@octokit/core");
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const owner = 'Oneflow-Inc';
const repo = 'oneflow';

function is_gpu_job(j) {
    return (["CPU", "CUDA", "XLA"].includes(j.name) || j.name == "CUDA, XLA, CPU")
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
        jobs_in_progress = r.data.jobs.filter(j => is_gpu_job(j) && j.status == "in_progress")
        jobs_all_queued = r.data.jobs.every(j => is_gpu_job(j) && j.status == "queued")
        jobs_in_progress.map(j => console.log(wr.id, "/", wr.name, "/", j.name, "/", j.status))
        schedule_job = r.data.jobs.find(j => j.name == "wait_for_gpu_slot")
        const has_passed_scheduler = (schedule_job && schedule_job.status == "completed") && jobs_all_queued
        if (has_passed_scheduler) {
            console.log(wr.id, "/", wr.name, "/", "queued")
        }
        return has_passed_scheduler || jobs_in_progress.length > 0;
    })
    return (await Promise.all(promises)).filter(is_running => is_running).length
}

const sleep = require('util').promisify(setTimeout)

async function start() {
    let i = 0;
    max_try = 600
    timeout = 2
    while (i < max_try) {
        console.log("trying", i + 1, "/", max_try)
        let num = await num_in_progress_runs()
        let max_num_parallel = 1
        console.log("in-progress runs:", num, ",", "max parallel runs:", max_num_parallel)
        if (num <= max_num_parallel) {
            return; // success
        }
        timeout = 60 * timeout
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
