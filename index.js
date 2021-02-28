const { Octokit } = require("@octokit/core");
const { assert } = require("console");
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = 'Oneflow-Inc';
const repo = 'oneflow';

function is_gpu_job(j) {
    return (
        ["CPU", "CUDA", "XLA"].includes(j.name)
        || j.name == "CUDA, XLA, CPU"
        || j.name.startsWith("CUDA, XLA, CPU")
        || j.name.startsWith("Test suite")
    )
}

const num_in_progress_runs = async function (status) {
    return await octokit.request('GET /repos/{owner}/{repo}/actions/runs', {
        owner: owner,
        repo: repo,
        status: status
    })
        .then(async r => {
            promises = r.data.workflow_runs.map(async wr => {
                const r = await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', {
                    owner: owner,
                    repo: repo,
                    run_id: wr.id
                });
                r.data.jobs.map(j => console.log(wr.status, wr.id, "/", wr.name, "/", j.name, "/", j.status))
                jobs_in_progress = r.data.jobs.filter(j => is_gpu_job(j) && j.status == "in_progress")
                jobs_all_queued = r.data.jobs.filter(j => is_gpu_job(j)).every(j => j.status == "queued" || j.status == "in_progress")
                schedule_job = r.data.jobs.find(j => j.name == "Wait for GPU slots")
                assert(schedule_job)
                const has_passed_scheduler = (schedule_job && schedule_job.status == "completed") && jobs_all_queued
                return has_passed_scheduler || jobs_in_progress.length > 0;
            })
            is_running_list = await Promise.all(promises)
            r.data.workflow_runs
                .map((wr, i) => {
                    is_running = is_running_list[i] ? "running" : "not running"
                    pr = wr.pull_requests.map(pr => "#" + pr.number).join(", ")
                    console.log(pr, is_running)
                })
            return is_running_list.filter(is_running => is_running).length
        }
        )
}

const sleep = require('util').promisify(setTimeout)

async function start() {
    let i = 0;
    const max_try = 600
    const timeout_minutes = 1
    while (i < max_try) {
        console.log("trying", i + 1, "/", max_try)
        num = 100000
        try {
            num_list = await Promise.all([num_in_progress_runs("in_progress"), num_in_progress_runs("queued")])
            console.log("in-progress", num_list[0], "in-queue", num_list[1])
            num = num_list.reduce((a, b) => a + b, 0)
        } catch (error) {
            console.log(error)
            continue
        }
        let max_num_parallel = 1
        console.log("runs:", num, ",", "max:", max_num_parallel)
        if (num <= max_num_parallel) {
            return; // success
        }
        const timeout = 60 * timeout_minutes
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
