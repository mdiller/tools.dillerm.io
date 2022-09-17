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
const SERVED_PROJECTS = [];

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
	var invalid_pattern = /[^0-1a-zA-Z-_.]/;
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


	// TODO: ADD LOGIC HERE TO ONLY DO INSTALL N BUILD IF THE GIT VERSION CHANGED
	if (fs.existsSync(project_dir + "/package.json")) {
		console.log(`] installing packages...`);
		if (!shellExecSync(`npm install --silent`, project_dir)) {
			return null; // nothing more to do if this fails
		}
	
		console.log(`] building...`);
		if (!shellExecSync(`npm run build --silent`, project_dir)) {
			return null; // nothing more to do if this fails
		}

		// TODO: add logic here for replacing ?version=dev with ?version=libversion. also do this when updating our lib.

		if (!SERVED_PROJECTS.includes(project)) {
			console.log(`] serving...`);
			app.use(`/${project}`, express.static(`${PROJECTS_DIR}/${project}/build`));
			SERVED_PROJECTS.push(project);
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
app.get("/githook/:project", asyncHandler(async (req, res) => {
	await updateProject(req.params.project);

	console.dir(req.body);
	
	res.status(200);
	res.setHeader("Content-Type", "text/html");
	res.send("Done!");
}));

app.get("/lib/:filename", asyncHandler(async (req, res) => {
	// probably move this to be handled at top of script in future
	var filename = req.params.filename;
	var invalid_pattern = /[^0-1a-zA-Z-_.]/;
	if (filename.match(invalid_pattern)) {
		res.status(404);
		res.setHeader("Content-Type", "text/html");
		res.send(`invalid lib file name: ${filename}`);
		return;
	}

	var libpath = `${PROJECTS_DIR}/${LIB_PROJECT_NAME}`;
	
	// TODO: add a thing here for if theres a ?version=dev to do a different path
	var filepath = `${libpath}/build/${filename}`;

	if (!fs.existsSync(filepath)) {
		res.status(404);
		res.setHeader("Content-Type", "text/html");
		console.error(filepath);
		res.send(`file '${filename}' not found!`);
		return;
	}
	res.status(200);
	res.sendFile(filepath);
}));

app.get("/", asyncHandler(async (req, res) => {
	// probably move this to be handled at top of script in future
	var html = fs.readFileSync(__dirname + "/index.html", "utf8");

	// template fill


	res.status(200);
	res.setHeader("Content-Type", "text/html");
	res.send(html);
}));


// error handler
app.use((err, req, res, next) => {
	console.error(`Error on req: ${req.originalUrl}`);
	console.error(err);
	res.status(500).send("Oops, something broke. Check the logs.");
});