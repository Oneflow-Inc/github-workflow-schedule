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
var Table = require('cli-table3');

function is_gpu_job(j) {
  return (
    ['CPU', 'CUDA', 'XLA'].includes(j.name) || j.name == 'CUDA, XLA, CPU' ||
    j.name.startsWith('CUDA, XLA, CPU') || (
      j.name.startsWith('Test suite') && (
        j.name.includes("cuda") || j.name.includes("xla")
      )
    )
  )
}

const is_occupying_gpu = async (wr) => {
  const r = await octokit.request(
    'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
    { owner: owner, repo: repo, run_id: wr.id });
  pull_requests = wr.pull_requests;
  if (pull_requests.length == 0) {
    pull_requests = [{ number: '?' }];
  }
  pr = wr.pull_requests.length > 0 ? wr.pull_requests.map(pr => '#' + pr.number).join(', ') : "#?";
  console.log(wr.id, wr.status, pr, wr.name)
  console.log(wr.html_url)
  var table = new Table();
  r.data.jobs.map((j, job_i) => table.push([
    j.name, j.status
  ]));
  console.log(table.toString());
  jobs_in_progress =
    r.data.jobs.filter(j => is_gpu_job(j) && j.status == 'in_progress');
  jobs_all_queued =
    r.data.jobs.filter(j => is_gpu_job(j))
      .every(j => j.status == 'queued' || j.status == 'in_progress');
  schedule_job = r.data.jobs.find(j => j.name == 'Wait for GPU slots');
  const has_passed_scheduler =
    (schedule_job && schedule_job.status == 'completed') && jobs_all_queued;
  return has_passed_scheduler || jobs_in_progress.length > 0;
};

// TODO: refactor into in_progress_runs_larger_that(1)
const num_in_progress_runs =
  async function (statuses) {
    workflow_runs =
      (await Promise.all(statuses.map(
        async s => await octokit
          .request(
            'GET /repos/{owner}/{repo}/actions/runs',
            { owner: owner, repo: repo, status: s })
          .then(r => r.data.workflow_runs)
          .catch(e => []))))
        .flat()

    console.log('found', workflow_runs.length, 'workflow runs for', statuses)
    if (workflow_runs.length == 0) {
      console.log('no workflow runs found for', statuses)
      console.log('start querying 100 workflow runs')
      workflow_runs = (await octokit
        .request(
          'GET /repos/{owner}/{repo}/actions/runs',
          { owner: owner, repo: repo, per_page: 100 })
        .then(r => r.data.workflow_runs))
        .filter(w => statuses.includes(w.status))
      console.log('found', workflow_runs.length, 'workflow runs in last 100')
    }
    is_running_list = await Promise.all(workflow_runs.map(
      async wr => await is_occupying_gpu(wr).catch(e => { console.log(e); return false })))
    var table = new Table();
    workflow_runs.map(
      (wr, wr_i) => {
        table.push([
          wr.id,
          is_running_list[wr_i] ? 'running' : '--',
          wr.pull_requests.map(pr => '#' + pr.number).join(", "),
          wr.pull_requests.map(pr => 'https://github.com/Oneflow-Inc/oneflow/pull/' + pr.number).join("\n"),
          wr.html_url,
        ])
      })
    console.log(table.toString());
    return is_running_list.filter(is_running => is_running).length
  }

const sleep = require('util').promisify(setTimeout)



async function start() {
  let i = 0;
  const max_try = 30
  const timeout_minutes = 1
  let max_num_parallel = 2
  while (i < max_try) {
    i += 1;
    console.log('trying', i, '/', max_try)
    num = 100000
    try {
      num = await num_in_progress_runs(['in_progress', 'queued'])
    } catch (error) {
      console.log(error)
      continue
    } finally {
      console.log('runs:', num, ',', 'max:', max_num_parallel)
      if (num < max_num_parallel) {
        return;  // success
      }
      const timeout = 60 * timeout_minutes;
      await sleep(timeout * 1000)
      console.log('timeout', timeout, 's')
    }
  }
}

start().catch(error => {
  const core = require('@actions/core');
  core.setFailed(error.message);
})
