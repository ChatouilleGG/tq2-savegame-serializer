
//============================================================
// Main

const fs = require('fs');
const path = require('path');
const util = require('util');

const TQ2SS = require('./serializer');

const Args = {
	inputFile: null,
	entryPoint: 'File_Data_Player',
	outputJson: null,
	outputResave: null,
};

function die(msg) {
	console.error(msg);
	process.exit(1);
}

function explicitlyFalse(arg) { return (arg === '0' || arg === 'false' || arg === 'off') }

function setArg(key, val) {
	if (key === undefined) {
		if (Args.inputFile) die("Extraneous argument '"+val+"'");
		Args.inputFile = val;
	}
	else if (key == "entry")
		Args.entryPoint = val || die("Entry point argument specified but not set");
	else if (key == "json")
		Args.outputJson = val || "out.json";
	else if (key == "resave")
		Args.outputResave = val || "out.sav";
	else if (key == "skipreflection" && !explicitlyFalse(val))
		TQ2SS.Options.JsonSkipReflection = true;
	else if (key == 'earlyexit' && !explicitlyFalse(val))
		TQ2SS.Options.EarlyExit = true;
	else
		die("Unknown argument '" + key + "'");
}

for (let i=2; i<process.argv.length; i++) {
	let arg = process.argv[i];
	if (arg.startsWith("-")) {
		arg = arg.replace(/^\-+/, "");
		let p = arg.indexOf("=");
		if (p != -1)
			setArg(arg.toLowerCase().substr(0,p), arg.substr(p+1));
		else
			setArg(arg.toLowerCase(), undefined);
	}
	else
		setArg(undefined, arg);
}

if (!Args.inputFile)
	die("Missing input file");

const reader = TQ2SS.UReader.fromFile(path.resolve(Args.inputFile));

let data = reader[Args.entryPoint]();

console.log(util.inspect(data, {colors:true,depth:4}));

if (Args.outputJson) {
	const filePath = path.resolve(Args.outputJson);
	fs.writeFileSync(filePath, TQ2SS.ToJson(data));
	console.log("Wrote:", filePath);
}

if (!reader.isEOF())
	die("Deserialization complete but reader has not reached end-of-file");

if (Args.outputResave) {
	const filePath = path.resolve(Args.outputResave);
	const writer = TQ2SS.UWriter.toFile(filePath);
	writer[Args.entryPoint](data);
	writer.flush();
	console.log("Wrote:", filePath);
}
