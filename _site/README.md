My website, powered by Jekyll, Bootstrap etc.

Real commit log branch is source, master is the generated website (because gh-pages is forbidden to execute custom Ruby)

Use this to overcome the gh-pages shortcoming : 
* `publish-jekyll = "!f() {` 
	- `jekyll build;`
	- `git add _site;` 
	- ````git commit -m \"`date`\";``` 
	- `git branch -D master;`
	- `git checkout -b master;` 
	- `git filter-branch --subdirectory-filter _site/ -f;`
	- `git checkout source;` 
	- `git push --all origin;};`
* `f"`
