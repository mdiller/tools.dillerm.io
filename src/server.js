const express = require("express");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");
const util = require("util");
const shell = require("shelljs");

// promisified fs stuff
const fs_readdir = util.promisify(fs.readdir);

var DEBUG = false;
var LISTEN_PORT = 3000;
if (process.env.LISTEN_PORT && !isNaN(process.env.LISTEN_PORT)) {
	LISTEN_PORT = parseInt(process.env.LISTEN_PORT)
}
console.log(`] hosting on port ${LISTEN_PORT}`);
var LIB_PROJECT_VERSION = null; // gets set right away on startup
const GITHUB_API_ROOT = "https://api.github.com";
const GITHUB_ACCOUNT = "mdiller";
const PROJECTS_DIR = path.resolve("./projects");
const LIB_DEV_DIR = path.resolve("./libdev");
const LIB_PROJECT_NAME = "dillerm-webutils";

const PROJECTS = [];
const PROJECT_INFOS = {};
const SERVED_PROJECTS = [];

shell.config.silent = true;

function localizeDate(date) { 
	var date = new Date(date);

	var day = date.getDate();
	var month = date.toLocaleString("en-US", {month: "short"});
	var year = 1900 + date.getYear();

	return `${day}-${month}-${year}`;
}

// Gets the hash of the last commit for the repository at the given directory
function getGitHash(dir) {
	const cd_result = shell.cd(dir);
	if (cd_result.code != 0) {
		console.error(`exit code ${cd_result.code}! (during cd)`);
		return false;
	}
	const command = "git rev-parse --short HEAD"
	const result = shell.exec(command);
	if (result.code != 0) {
		console.log(result.stdout);
		console.log(result.stderr);
		console.error(`exit code ${result.code}!`);
		return false;
	}
	return result.stdout.trim();
}

// Executes a shell command at the given directory
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
	console.log("> starting up...");
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


// updates the library version for all html files in the project's build directory
async function updateLibVersion(project) {
	const target_dir = `${PROJECTS_DIR}/${project}/build`;
	if (DEBUG) {
		return;
	}
	if (fs.existsSync(target_dir)) {
		var files = fs.readdirSync(target_dir);
		for (var i = 0; i < files.length; i++) {
			var filename = path.join(target_dir, files[i]);
			if (filename.endsWith(".html")) {
				var pattern = /(https?:\/\/tools\.dillerm\.io\/lib\/[^?]+)\?version=([^"]+)/g;
				var text = fs.readFileSync(filename, { encoding: "utf8" });
				if (text.search(pattern)) {
					console.log(`] Fixing version for ${filename}`);
					text = text.replace(pattern, `$1?version=${LIB_PROJECT_VERSION}`);
					fs.writeFileSync(filename, text);
				}
			}
		};
	}
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

// builds the selected project
async function updateProjectBuild(project) {
	const project_dir = `${PROJECTS_DIR}/${project}`;
	
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
		await updateLibVersion(project);
	}
	else {
		console.warn("] No package.json exists for this repo");
	}
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

	var git_hash_before = null;
	const project_dir = `${PROJECTS_DIR}/${project}`;
	if (!fs.existsSync(project_dir)) {
		console.log(`] cloning...`);
		var success = shellExecSync(`git clone ${project_info.clone_url} ${project}`, PROJECTS_DIR);
		if (!success) {
			return null; // nothing more to do if this fails
		}
	}
	else {
		git_hash_before = getGitHash(project_dir);
		console.log(`] pulling...`);
		if (!shellExecSync(`git pull`, project_dir)) {
			return null; // nothing more to do if this fails
		}
	}
	var git_hash_after = getGitHash(project_dir);
	var git_updated = git_hash_before != git_hash_after;

	if (project == LIB_PROJECT_NAME) {
		LIB_PROJECT_VERSION = git_hash_after;
	}

	if (git_updated) {
		await updateProjectBuild(project);
		
		if (project == LIB_PROJECT_NAME) {
			console.log("] Update templates for all projects")
			for (let i = 0; i < PROJECTS.length; i++) {
				if (PROJECTS[i] != LIB_PROJECT_NAME) {
					await updateLibVersion(PROJECTS[i]);
				}
			}
		}
	}
	
	if (!SERVED_PROJECTS.includes(project)) {
		console.log(`] serving...`);
		app.use(`/${project}`, express.static(`${PROJECTS_DIR}/${project}/build`));
		SERVED_PROJECTS.push(project);
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

// Favicon
app.use("/favicon.ico", express.static(path.join(__dirname, "assets", "favicon.ico")));

app.use(express.json());
app.post("/githook", asyncHandler(async (req, res) => {
	console.log(`> ${req.originalUrl}`);
	var project = req.body.repository.name;
	await updateProject(project);

	res.status(200);
	res.setHeader("Content-Type", "text/html");
	res.send("Done!");
}));

app.get("/lib/:filename(*)", asyncHandler(async (req, res) => {
	var approved_subpaths = [ "images" ];
	var filename = req.params.filename;
	
	var valid_pattern = new RegExp(`^((${approved_subpaths.join("|")})/)?[0-1a-zA-Z-_.]+$`);
	if (!filename.match(valid_pattern)) {
		res.status(404);
		res.setHeader("Content-Type", "text/html");
		res.send(`<pre>invalid lib file name: ${filename}</pre>`);
		return;
	}

	filename = filename;

	var filepath = `${PROJECTS_DIR}/${LIB_PROJECT_NAME}/build/${filename}`;

	if (req.query.version == "dev") {
		filepath = `${LIB_DEV_DIR}/${filename}`;
	}

	if (!fs.existsSync(filepath)) {
		res.status(404);
		res.setHeader("Content-Type", "text/html");
		console.error(filepath);
		res.send(`<pre>file '${filename}' not found!</pre>`);
		return;
	}
	res.status(200);
	res.sendFile(filepath);
}));

app.get("/", asyncHandler(async (req, res) => {
	// probably move this to be handled at top of script in future
	var html = fs.readFileSync(__dirname + "/index.html", "utf8");
	var pattern = /\/\/ PROJECTS_LIST_START\s+.*\s+\/\/ PROJECTS_LIST_END/m
	if (html.search(pattern)) {
		var projects = PROJECTS.map(project => {
			var proj_info = PROJECT_INFOS[project];
			return {
				name: project,
				link: proj_info.homepage || `https://tools.dillerm.io/${project}`,
				github_link: proj_info.html_url,
				description: proj_info.description,
				created_at: localizeDate(proj_info.created_at),
				updated_at: localizeDate(proj_info.updated_at),
				language: proj_info.language
			}
		});
		var project_info_text = JSON.stringify(projects);
		html = html.replace(pattern, `var projects = ${project_info_text}`)
	}


	res.status(200);
	res.setHeader("Content-Type", "text/html");
	res.send(html);
}));


// error handler
app.use((err, req, res, next) => {
	console.error(`Error on req: ${req.originalUrl}`);
	console.error(err);
	res.status(500).send("<pre>Oops, something broke. Check the logs.</pre>");
});