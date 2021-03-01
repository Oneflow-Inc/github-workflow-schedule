const { Octokit } = require("@octokit/core");
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = 'Oneflow-Inc';
const repo = 'oneflow';
var Table = require('cli-table3');

function is_gpu_job(j) {
    return (
        ["CPU", "CUDA", "XLA"].includes(j.name)
        || j.name == "CUDA, XLA, CPU"
        || j.name.startsWith("CUDA, XLA, CPU")
        || j.name.startsWith("Test suite")
    )
}

const num_in_progress_runs = async function (statuses) {
    workflow_runs = (await Promise.all(
        statuses.map(async s => await octokit.request('GET /repos/{owner}/{repo}/actions/runs', {
            owner: owner,
            repo: repo,
            status: s
        }).then(r => r.data.workflow_runs)
        )
    )).flat()

    var table = new Table();
    promises = workflow_runs
        .map(async wr => {
            const r = await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', {
                owner: owner,
                repo: repo,
                run_id: wr.id
            });
            pull_requests = wr.pull_requests
            if (pull_requests.length == 0) {
                pull_requests = [{ number: "?" }]
            }
            pr = wr.pull_requests.map(pr => "#" + pr.number).join(", ")
            r.data.jobs.map((j, job_i) => table.push([
                job_i == 0 ? wr.id : "",
                job_i == 0 ? pr : "",
                job_i == 0 ? wr.status : "",
                job_i == 0 ? wr.name : "",
                j.name,
                j.status]))

            jobs_in_progress = r.data.jobs.filter(j => is_gpu_job(j) && j.status == "in_progress")
            jobs_all_queued = r.data.jobs.filter(j => is_gpu_job(j)).every(j => j.status == "queued" || j.status == "in_progress")
            schedule_job = r.data.jobs.find(j => j.name == "Wait for GPU slots")
            const has_passed_scheduler = (schedule_job && schedule_job.status == "completed") && jobs_all_queued
            return has_passed_scheduler || jobs_in_progress.length > 0;
        })
    is_running_list = await Promise.all(promises)
    console.log(table.toString());
    var table = new Table();
    workflow_runs
        .map((wr, wr_i) => {
            pr = wr.pull_requests.map((pr, pr_i) => {
                table.push([pr_i == 0 ? wr.id : "", pr_i == 0 ? (is_running_list[wr_i] ? "running" : "") : "", "#" + pr.number, "https://github.com/Oneflow-Inc/oneflow/pull/" + pr.number])
            })
        })
    console.log(table.toString());
    return is_running_list.filter(is_running => is_running).length
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
            num = await num_in_progress_runs(["in_progress", "queued"])
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
