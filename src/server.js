const express = require("express");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");
const util = require("util");
const shell = require("shelljs");

// promisified fs stuff
const fs_readdir = util.promisify(fs.readdir);

const LISTEN_PORT = 3000;
const GITHUB_API_ROOT = "https://api.github.com";
const GITHUB_ACCOUNT = "mdiller";
const PROJECTS_DIR = path.resolve("./projects");
const LIB_PROJECT_NAME = "dillerm-webutils";

const PROJECTS = [];
const PROJECT_INFOS = {};

// fs.rmSync(PROJECTS_DIR, { recursive: true });

function shellExecSync(command, dir) {
	const cd_result = shell.cd(dir);
	if (cd_result.code != 0) {
		console.error(`exit code ${cd_result.code}! (during cd)`);
		return false;
	}
	const result = shell.exec(command);
	if (result.code != 0) {
		console.log(result.stdout);
		console.log(result.stderr);
		console.error(`exit code ${result.code}!`);
		return false;
	}
	return true;
}

(async() => {
	await startup();
})();

async function startup() {
	console.log("] starting up...");
	if (!fs.existsSync(PROJECTS_DIR)) {
		fs.mkdirSync(PROJECTS_DIR);
	}
	else {
		fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
			.filter(dirent => dirent.isDirectory())
			.forEach(dirent => PROJECTS.push(dirent.name));
	}

	if (PROJECTS.length == 0) {
		PROJECTS.push(LIB_PROJECT_NAME);
	}

	for (let i = 0; i < PROJECTS.length; i++) {
		await updateProject(PROJECTS[i]);
	}
	console.log("] startup complete!");
}

// grabs repo info from github
async function updateProjectInfo(project) {
	// console.log(`] Querying info for: ${project}`);
	var response = await fetch(`${GITHUB_API_ROOT}/repos/${GITHUB_ACCOUNT}/${project}`);
	if (response.status != 200) {
		var errorMessage = response.status == 404 ? "404: repository not found!" : `http error ${response.status} when looking for this repo`;
		console.error(errorMessage);
		return null;
	}
	var body = await response.json();
	PROJECT_INFOS[project] = body;
	return body;
}

// takes the given project and updates both its stored information and its to-be-hosted files
async function updateProject(project) {
	var invalid_pattern = /[^0-1a-zA-Z\-_.]/;
	if (project.match(invalid_pattern)) {
		console.error(`invalid project name: ${project}`);
		return;
	}
	console.log(`] Updating: ${project}`);
	
	var project_info = await updateProjectInfo(project);
	if (project_info == null) {
		return null; // nothing to do here
	}

	var project_dir = `${PROJECTS_DIR}/${project}`;
	if (!fs.existsSync(project_dir)) {
		console.log(`] cloning...`);
		var success = shellExecSync(`git clone ${project_info.clone_url} ${project}`, PROJECTS_DIR);
		if (!success) {
			return null; // nothing more to do if this fails
		}
	}
	else {
		console.log(`] pulling...`);
		if (!shellExecSync(`git pull`, project_dir)) {
			return null; // nothing more to do if this fails
		}
	}

	// ONLY DO NEXT STEPS IF PACKAGE.JSON EXISTS
	if (fs.existsSync(project_dir + "/package.json")) {
		console.log(`] installing packages...`);
		if (!shellExecSync(`npm install --silent`, project_dir)) {
			return null; // nothing more to do if this fails
		}
	
		console.log(`] building...`);
		if (!shellExecSync(`npm run build --silent`, project_dir)) {
			return null; // nothing more to do if this fails
		}
	}
	else {
		console.warn("] No package.json exists for this repo");
	}

	if (!PROJECTS.includes(project)) {
		console.log(`] adding '${project}' to list of projects`);
		PROJECTS.push(project);
	}
	console.log(`] Done with: ${project}`);
}

const app = express();
app.listen(LISTEN_PORT); // port

// wrapper for handling endpoints
const asyncHandler = fn => (req, res, next) => {
    return Promise
        .resolve(fn(req, res, next))
        .catch(next);
};
app.use(asyncHandler(async(req, res, next) => {
	console.log(`> ${req.originalUrl}`);
	next();
}));

// ENDPOINTS
// endpoint: manual repo update/add? (see how much info we get in the update hook)
// endpoint: github repo update hook
// endpoint: main html homepage
// endpoint: child tools pages
app.use("/gitHook/:project", asyncHandler(async (req, res) => {
	await updateProject(req.params.project);
	
	res.status(200);
	res.setHeader("Content-Type", "text/html");
	res.send("Done!");
}));



// error handler
app.use((err, req, res, next) => {
	console.error(`Error on req: ${req.originalUrl}`);
	console.error(err);
	res.status(500).send("Oops, something broke. Check the logs.");
});