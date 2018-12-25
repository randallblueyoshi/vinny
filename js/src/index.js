const discord = require("discord.js");
const yaml = require("js-yaml");
const fs = require("promise-fs");
const path = require("path");
const glob = require("glob");
const delve = require("dlv");
const { debug, info, error, fatal, assert } = require("./logging.js");

async function main() {
	info(`Commit ${process.env.COMMIT || "unknown"}`);
	if (process.env.NODE_ENV === "production") {
		info("Production tier");
	} else {
		info("Dev tier");
	}

	debug("Loading config");
	assert(!!process.env.CONFIG, "valid config path");
	try {
		await fs.access(process.env.CONFIG, fs.constants.R_OK);
	} catch (e) {
		fatal("unreadable config path,", e);
	}
	const configString = await fs.readFile(process.env.CONFIG);
	const config = yaml.safeLoad(configString);
	debug("Config loaded:", config);

	debug("Loading secrets");
	assert(!!process.env.SECRETS, "valid secrets path");
	try {
		await fs.access(process.env.SECRETS, fs.constants.R_OK);
	} catch (e) {
		fatal("unreadable secrets path,", e);
	}
	const secretsString = await fs.readFile(process.env.SECRETS);
	const secrets = yaml.safeLoad(secretsString);
	debug("Secrets loaded");

	debug("Loading modules");
	const modulePaths = glob.sync(path.join(__dirname, "modules/**/*.js"));
	const modules = [];
	modulePaths.forEach(x => {
		const mod = require(path.resolve(x));
		mod.name = mod.name || path.parse(x).name;
		modules.push(mod);
	});
	info("Modules loaded:", modules.map(x => x.name));
	const moduleInstances = {};
	for (let [serverId, serverConfig] of Object.entries(config.servers)) {
		moduleInstances[serverId] = [];
		modules.forEach(mod => {
			if (delve(serverConfig, ["modules"], []).includes(mod.name)) {
				moduleInstances[serverId].push(
					mod.init({
						config: delve(
							serverConfig,
							["moduleConfig", mod.name],
							{}
						)
					})
				);
			}
		});
	}

	await initaliseDiscord(config, secrets, moduleInstances);
}

async function initaliseDiscord(config, secrets, moduleInstances) {
	const dclient = new discord.Client();

	dclient.on("ready", x => {
		info(`Logged in as ${dclient.user.tag}`);
	});

	dclient.on("ready", () => {
		for (let [server, mods] of Object.entries(moduleInstances)) {
			mods.forEach(x => {
				if (typeof x.onReady === "function") {
					x.onReady({ dclient });
				}
			});
		}
	});

	function callModules(obj, event, args) {
		moduleInstances[obj.guild.id].forEach(x => {
			if (typeof x[event] === "function") {
				x[event](Object.assign(args, { dclient }));
			}
		});
	}

	dclient.on("messageUpdate", (prev, next) => {
		callModules(next, "onEdit", { prev, next });
	});

	dclient.on("guildMemberUpdate", (prev, next) => {
		callModules(next, "onMemberEdit", { prev, next });
	});

	dclient.on("message", msg => {
		callModules(msg, "onMessage", { msg });
	});

	dclient.login(secrets.discordToken);

	return new Promise((resolve, reject) => {
		dclient.on("ready", x => {
			resolve(dclient);
		});
	});
}

main();
