/**
 * get things from the fan wiki
 * 
 * argv: [file_name [api_point]]
 */

const fs = require('fs/promises');
const path = require('path');
const https = require('https');

const tmp = false;
const file = process.argv[2] ?? path.join(__dirname, "pico8api.txt");
const point = process.argv[3] ?? "https://pico-8.fandom.com/api.php";

existing(path.join(__dirname, "out")).then(_=> {
  fs.readFile(file).then(buffer => {
    let type;
    buffer.toString().split("\n").forEach(line => {
      line = line.trim(); if (!line) return;
      if (line.startsWith("#")) {
        line = line.substr(1).trim();
        if (line.startsWith("next:")) type = line.substr(5).trim();
      } else {
        const name = line.split("(", 1)[0];
        const tags = line.substr(line.indexOf("#")+1).trim().split(",").map(it => it.trim());
        if (name) make(name, type, tags);
      }
    });
  });
});

/**
 * @param {string} type "commands", "redefines", "functions", "variables"
 * @param {string[]} tags "no-doc", "no-wiki", "no-run", "deprecated"
 */
function make(name, type, tags) {
  (tags.includes("no-wiki")
    ? Promise.resolve("")
    : tmp
      ? fs.readFile(path.join(__dirname, "tmp", type, name))
      : fetch(`${point}?action=parse&format=json&prop=wikitext&page=${escape(name)}`)
  ).then(obj => {
    /** @type {string} */
    const data = (obj?.parse?.wikitext?.['*'] ?? obj?.toString() ?? "").trim();
    /**
     * @typedef {Object} Info
     * @property {string} name
     * @property {LuaType} type
     * @property {string} doc
     */
    /** @type {Info} */
    const info = { name };
    console.log("making doc for " + name);

    if (data.startsWith("{{")) {
      const lines = data.split("\n");
      const shortdesc = lines[2].substr(11).trim();
      let k = 3;
      const params = [];
      while (!lines[k].includes("}}")) {
        const [, name, optional, desc] = lines[k++].split("|");
        params.push({
          name, desc,
          optional: !!optional,
        });
      }
      info.type = {
        parameters: params.map(it => ({ name: it.name, type: 'any' })),
        return: 'any',
      };
      info.doc = `${shortdesc}\n\n${params.map(it => `\`${it.name}\`: ${it.desc}`).join("\n\n")}${params.length ? "\n\n" : ""}[wiki - ${name}](https://pico-8.fandom.com/wiki/${name})`;
    } else if (data.toLowerCase().startsWith("#redirect")) {
      const what = /\[\[(.*?)\]\]/.exec(data.split("\n")[0])[1];
      info.type = { parameters: [{ name: "...", type: 'any' }], return: 'any' };
      info.doc = `See [${what}](https://pico-8.fandom.com/wiki/${what})`;
    } else if (!data.startsWith("#")) {
      const lines = data.split("\n");
      let k = 0;
      const sublist = [];
      while (!lines[k].includes("==")) {
        const line = lines[k++].trim();
        if (line) sublist.push(line);
      }
      info.type = { parameters: [], return: 'nil' };
      info.doc = sublist.join("\n\n");
    } else {
      info.type = 'any';
      info.doc = "";
    }

    info.doc = info.doc
      .replace(/<pre class="p8sh">(.*?)<\/pre>/gs, "```\n$1```")
      .replace(/<syntaxhighlight lang="lua">(.*?)<\/syntaxhighlight>/gs, "```lua\n$1```")
      .replace(/<code>(.*?)<\/code>/gs, "`$1`")
      .replace(/<sup>(.*?)<\/sup>/gs, "$1")
      .replace(/\[\[File:(.*?)\]\]/gs, "")
      .replace(/\[\[([^|]+?)(?:\|(.+?))?\]\]/gs, "[$2](https://pico-8.fandom.com/wiki/$1)");

    const dir = path.join(__dirname, "out", type);
    existing(dir).then(_=> fs.writeFile(path.join(dir, name + ".json"), JSON.stringify(info, null, 2)));
  });
}

/**
 * @returns {Promise<JSON.parse>}
 */
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      console.log("fetching " + url);
      const data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', _=> resolve(JSON.parse(Buffer.concat(data))));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * @returns {Promise<void>}
 */
function existing(dir) {
  return new Promise(resolve => fs.mkdir(dir).then(resolve, resolve));
}
