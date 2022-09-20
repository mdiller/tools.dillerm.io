# tools.dillerm.io

A site for showcasing and hosting my various webtools. The idea is that this project will make it much easier to add/develop/host new webtools in the future, as well as providing a place to showcase a list of all the webtools ive built.

## Features

- [ ] Home page with a list of webtools
  - [x] Create homepage blank site
  - [ ] Add list of webtools
  - [ ] Add interesting stats for each of them
- [x] Trigger re-download/build of a webtool with a git webhook
- Things to do when a webtool update is triggered
  - [x] Retrieve repo stats from github
  - [x] Create directory for it if it doesnt exist
  - [x] Do a git pull/clone
  - If there was a git change and package.json exists,
    - [x] npm install
    - [x] npm run build
    - [x] make sure the repo is being served from tools.dillerm.io/{projname}
- [x] Trigger re-load of projects on startup
- [x] Handle versioning of library nicely
  - [x] Template-fill all built html files to change `*tools.dillerm.io/lib*?version=dev` to be `?version=<latest dillerm-webtools githash>`
  - [x] Serve the dev version of the lib from a repo that gets update by an rsync thing
- [x] Add more projects!