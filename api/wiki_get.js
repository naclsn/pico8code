/**
 * get things from the fan wiki
 * 
 * argv: [file_name [api_point]]
 */

const fs = require('fs/promises');
const path = require('path');
const https = require('https');

const tmp = true;
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
    const data = obj?.parse?.wikitext?.['*'] ?? obj?.toString();
    /**
     * @typedef {Object} Info
     * @property {string} name
     * @property {LuaType} type
     * @property {string} doc
     */
    /** @type {Info} */
    const info = { name };

    ;

    const dir = path.join(__dirname, "out", type);
    existing(dir).then(_=> fs.writeFile(path.join(dir, name), JSON.stringify(info)));
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
