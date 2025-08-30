//============================================================
// TQ2 Savegame parser / serializer
// (c) Chatouille
//============================================================

(function() {

if (typeof(Buffer) == 'undefined') {
	let script = document.createElement('script');
	script.src = 'https://bundle.run/buffer@6.0.3';
	script.onload = function() {
		window.Buffer = buffer.Buffer;
	}
	document.head.appendChild(script);
}

//============================================================
// Base class of UReader and UWriter
// To reduce duplication, add shared serialization routines into this class.
// Most structures can share the same serialization code whether reading or writing :
// - when reading, ignore the 'val' parameter and return what is read
// - when writing, write the 'val' parameter and ignore the return value

class UBuffer {

	isReader() { return false; }
	isWriter() { return false; }

	seek(position) {
		if (position < 0 || position >= this.buffer.length)
			throw new Error("Cannot seek outside of buffer bounds ("+position+" / " + this.buffer.length + ")");
		this.offset = position;
	}

	// buffer-to-buffer
	raw() {}

	fname(val) {
		// In this context, FNames are serialized as FStrings
		return this.fstring(val);
	}

	bool(val) {
		// Bools are serialized over 4 bytes most of the time, for some reason
		return this.uint32(val);
	}

	object(val) {
		// In this context, objects are serialized by name
		return this.fname(val);
	}

	tmap(keyType, valueType, val) {
		val || (val = {});
		let keys = [...(val.keys || [])];
		let values = [...(val.values || [])];
		let size = this.uint32(keys.length);
		for (let i=0; i<size; i++) {
			keys.push(this[keyType](keys[i]));
			values.push(this[valueType](values[i]));
		}
		return { keys, values };
	}

	tarray(innerType, val) {
		val || (val = []);
		let size = this.uint32(val.length);
		let result = [];
		for (let i=0; i<size; i++)
			result.push( (typeof(innerType) == 'function') ? innerType(val[i]) : this[innerType](val[i]) );
		return result;
	}
}

UBuffer.prototype.NativeSerializedStructs = {};
UBuffer.registerNativeStruct = function(typeName) {
	if (typeof(typeName) == 'function')
		typeName = typeName.name;

	// When referenced by UProperties, structs don't have the F prefix
	UBuffer.prototype.NativeSerializedStructs[typeName.substr(1)] = typeName;
}

// Map a type name to another.
// Two use cases :
// (1) Some types are just a wrapper for another type, ex: FGameplayTag -> FName
// (2) Struct types within TMap and TSet are not serialized - we map them by name when necessary
UBuffer.registerNativeAlias = function(fromTypeName, toTypeName) {
	UBuffer.prototype.NativeSerializedStructs[fromTypeName] = toTypeName;
}

//============================================================
// Reader base

//NOTE: There is an oddity with serialization of FText -
// Empty strings are serialized as Size=1 with a null character, instead of just Size=0.
const EMPTY_STR_AS_NULL_CHAR = "<empty>";

class UReader extends UBuffer {
	constructor(buffer) {
		super();

		if (typeof(window) != 'undefined' && buffer instanceof ArrayBuffer)
			buffer = Buffer.from(buffer);

		this.buffer = buffer;
		this.offset = 0;
	}

	static fromFile(filePath) {
		if (typeof(process) == 'undefined')
			throw new Error("Cannot use fromFile() in web browser - read input file as array buffer and use default constructor instead");

		return new UReader(require('fs').readFileSync(filePath));
	}

	isReader() { return true; }

	raw(size) {
		this.offset += size;
		return this.buffer.slice(this.offset-size, this.offset);
	}

	int8() {
		this.offset += 1;
		return this.buffer.readInt8(this.offset-1);
	}
	uint8() {
		this.offset += 1;
		return this.buffer.readUInt8(this.offset-1);
	}
	int16() {
		this.offset += 2;
		return this.buffer.readInt16LE(this.offset-2);
	}
	uint16() {
		this.offset += 2;
		return this.buffer.readUInt16LE(this.offset-2);
	}
	int32() {
		this.offset += 4;
		return this.buffer.readInt32LE(this.offset-4);
	}
	uint32() {
		this.offset += 4;
		return this.buffer.readUInt32LE(this.offset-4);
	}
	int64() {
		this.offset += 8;
		return this.buffer.readBigInt64LE(this.offset-8);
	}
	float() {
		this.offset += 4;
		let f = this.buffer.readFloatLE(this.offset-4);
		//return Math.round(f*1000000)/1000000;
		return f;
	}
	double() {
		this.offset += 8;
		return this.buffer.readDoubleLE(this.offset-8);
	}

	fstring() {
		let size = this.int32();
		if (size >= 0) {
			this.offset += size;
			if (size == 1)
				return EMPTY_STR_AS_NULL_CHAR;
			return this.buffer.toString('utf8', this.offset-size, this.offset-1);
		}
		else {
			size *= -2;
			this.offset += size;
			return this.buffer.toString('utf16le', this.offset-size, this.offset-2);
		}
	}

	isEOF() {
		return this.offset == this.buffer.length;
	}
}

//============================================================
// Writer base

const WRITE_BUF_SIZE = 100000;

class UWriter extends UBuffer {
	constructor() {
		super();

		this.buffer = Buffer.alloc(WRITE_BUF_SIZE);
		this.offset = 0;
	}

	static toFile(filePath) {
		if (typeof(process) == 'undefined')
			throw new Error("Cannot use toFile() in web browser - use default constructor and getBuffer() at the end");

		let writer = new UWriter();
		writer.filePath = filePath;
		require('fs').writeFileSync(filePath, "");
		return writer;
	}

	isWriter() { return true; }

	checkBuf(forSize) {
		if (this.offset+forSize >= this.buffer.length) {
			let newBuffer = Buffer.alloc(this.offset + forSize + WRITE_BUF_SIZE);
			this.buffer.copy(newBuffer, 0, 0, this.buffer.length);
			this.buffer = newBuffer;
		}
	}

	// Convenience method to temporarily go back to write something
	goBack(position, callback) {
		let bkpOffset = this.offset;
		this.seek(position);
		callback(bkpOffset);
		this.seek(bkpOffset);
	}

	raw(size, inBuf) {
		this.checkBuf(inBuf.length);
		this.offset += inBuf.copy(this.buffer, this.offset);
	}

	int8(val) {
		this.checkBuf(1);
		this.offset = this.buffer.writeInt8(val, this.offset);
		return val;
	}
	uint8(val) {
		this.checkBuf(1);
		this.offset = this.buffer.writeUInt8(val, this.offset);
		return val;
	}
	int16(val) {
		this.checkBuf(2);
		this.offset = this.buffer.writeInt16LE(val, this.offset);
		return val;
	}
	uint16(val) {
		this.checkBuf(2);
		this.offset = this.buffer.writeUInt16LE(val, this.offset);
		return val;
	}
	int32(val) {
		this.checkBuf(4);
		this.offset = this.buffer.writeInt32LE(val, this.offset);
		return val;
	}
	uint32(val) {
		this.checkBuf(4);
		this.offset = this.buffer.writeUInt32LE(val, this.offset);
		return val;
	}
	int64(val) {
		this.checkBuf(8);
		this.offset = this.buffer.writeBigInt64LE(val, this.offset);
		return val;
	}
	float(val) {
		this.checkBuf(4);
		this.offset = this.buffer.writeFloatLE(val, this.offset);
		return val;
	}
	double(val) {
		this.checkBuf(8);
		this.offset = this.buffer.writeDoubleLE(val, this.offset);
		return val;
	}

	fstring(val) {
		if (val == EMPTY_STR_AS_NULL_CHAR) {
			this.int32(1);
			this.int8(0);
		}
		else if (val.length > 0) {
			this.int32(val.length+1);
			this.checkBuf(val.length+1);
			this.offset += this.buffer.write(val, this.offset, val.length, 'ascii') + 1;
		}
		else {
			this.int32(0);
		}
		return val;
	}

	// Get buffer (trimmed) (as ArrayBuffer in web browser)
	getBuffer() {
		if (typeof(window) != 'undefined')
			return this.buffer.buffer.slice(0, this.offset);
		else
			return this.buffer.slice(0, this.offset);
	}

	flush() {
		if (typeof(process) == 'undefined')
			throw new Error("Cannot use flush() in web browser - use getBuffer() instead to retrieve bytes");

		require('fs').writeFileSync(this.filePath, this.getBuffer(), { flag:'a' });
		this.buffer = Buffer.alloc(WRITE_BUF_SIZE);
		this.offset = 0;
	}
}

//============================================================
// Core static structures

UBuffer.prototype.FSaveGameHeader = function(val) {
	val || (val = {});
	return {
		FileTypeTag: this.int32(val.FileTypeTag),
		SaveGameFileVersion: this.int32(val.SaveGameFileVersion),
		PackageFileUEVersion: this.FPackageFileVersion(val.PackageFileUEVersion),
		SavedEngineVersion: this.FEngineVersion(val.SavedEngineVersion),
		CustomVersionFormat: this.int32(val.CustomVersionFormat),
		CustomVersions: this.FCustomVersionContainer(val.CustomVersions),
		SaveGameClassName: this.fstring(val.SaveGameClassName),
	};
}

UBuffer.prototype.FPackageFileVersion = function(val) {
	val || (val = {});
	return {
		FileVersionUE4: this.int32(val.FileVersionUE4),
		FileVersionUE5: this.int32(val.FileVersionUE5),
	};
}

UBuffer.prototype.FEngineVersion = function(val) {
	val || (val = {});
	return {
		Major: this.uint16(val.Major),
		Minor: this.uint16(val.Minor),
		patch: this.uint16(val.patch),
		Changelist: this.uint32(val.Changelist),
		Branch: this.fstring(val.Branch),
	};
}

UBuffer.prototype.FCustomVersionContainer = function(val) {
	val || (val = {});
	return this.tarray('FCustomVersion', val);
}

UBuffer.prototype.FCustomVersion = function(val) {
	val || (val = {});
	return {
		Key: this.FGuid(val.Key),
		Version: this.int32(val.Version),
	};
}

UBuffer.prototype.FGuid = function(val) {
	val || (val = []);
	return [this.uint32(val[0]), this.uint32(val[1]), this.uint32(val[2]), this.uint32(val[3])];
}
UBuffer.registerNativeStruct('FGuid');

UBuffer.prototype.ftext = function(val) {
	val || (val = {});
	let result = {
		Flags: this.uint32(val.Flags),
		HistoryType: this.int8(val.HistoryType),
	};
	if (result.HistoryType == -1) {
		result.bHasCultureInvariantString = this.bool(val.bHasCultureInvariantString);
		if (result.bHasCultureInvariantString)
			result.CultureInvariantString = this.fstring(val.CultureInvariantString);
		return result;
	}
	if (result.HistoryType == 0) {	//Base
		result.Namespace = this.fstring(val.Namespace);
		result.Key = this.fstring(val.Key);
		result.SourceString = this.fstring(val.SourceString);
		return result;
	}
	if (result.HistoryType == 1) {	//NamedFormat
		result.FormatText = this.ftext(val.FormatText);
		result.Arguments = this.tmap('fstring', 'FFormatArgumentValue', val.Arguments);
		return result;
	}
	if (result.HistoryType == 2) {	//OrderedFormat
		result.FormatText = this.ftext(val.FormatText);
		result.Arguments = this.tarray('FFormatArgumentValue', val.Arguments);
		return result;
	}
	if (result.HistoryType == 4) {	//AsNumber
		result.SourceValue = this.FFormatArgumentValue(val.SourceValue);
		result.bHasFormatOptions = this.bool(val.bHasFormatOptions);
		if (result.bHasFormatOptions)
			result.FormatOptions = this.raw(25, val.FormatOptions);
		result.CultureName = this.fstring(val.CultureName);
		return result;
	}
	if (result.HistoryType == 11) {	//StringTableEntry
		result.TableId = this.fname(val.TableId);
		result.Key = this.fstring(val.Key);
		return result;
	}
	return console.error("Cannot handle FText with HistoryType " + result.HistoryType);
};

UBuffer.prototype.FFormatArgumentValue = function(val) {
	val || (val = {});
	let result = { Type: this.int8(val.Type) || val.Type };
	if (result.Type == 3) result.Value = this.double(val.Value);
	if (result.Type == 2) result.Value = this.float(val.Value);
	if (result.Type == 0) result.Value = this.int64(val.Value);
	if (result.Type == 1) result.Value = this.uint64(val.Value);
	if (result.Type == 4) result.Value = this.ftext(val.Value);
	return result;
};

UBuffer.prototype.FGameplayTagContainer = function(val) {
	return this.tarray('fname', val);
}
UBuffer.registerNativeStruct('FGameplayTagContainer');

UBuffer.prototype.FSoftObjectPath = function(val) {
	val || (val = {});
	return {
		PackageName: this.fstring(val.PackageName),
		AssetName: this.fname(val.AssetName),
		SubPathString: this.fstring(val.SubPathString),
	};
}
UBuffer.registerNativeStruct('FSoftObjectPath');

UBuffer.prototype.FIntPoint = function(val) {
	val || (val={});
	return {
		X: this.int32(val.X),
		Y: this.int32(val.Y),
	};
}
UBuffer.registerNativeStruct('FIntPoint');

UBuffer.prototype.FLinearColor = function(val) {
	val || (val = {});
	return {
		R: this.float(val.R),
		G: this.float(val.G),
		B: this.float(val.B),
		A: this.float(val.A),
	};
};
UReader.registerNativeStruct('FLinearColor');

UBuffer.registerNativeAlias('GameplayTag', 'fname');
UBuffer.registerNativeAlias('DateTime', 'int64');

//============================================================
// Dynamic properties

UReader.prototype.FPropertyList = function(_, withExtraBytes) {
	let result = {};
	result[SerializerOptions.PropertiesKey] = [];
	while (true) {
		let tag = this.FPropertyTag();

		if (tag.Name == "None")	//end of list
			break;

		result[SerializerOptions.PropertiesKey].push(tag);

		//console.debug("-", tag.Type, tag.Name, tag.tag_offset, tag.data_offset, tag.Size);

		result[tag.Name] = this.FPropertyValue(tag);
	}

	// For some reason there's these 4 additional bytes at top-level property lists, but not within structs
	if (withExtraBytes)
		this.int32();

	return result;
}

//NOTE: When writing UProperties, we need to go back and rewrite tag.Size after writing the property value!
UWriter.prototype.FPropertyList = function(val, withExtraBytes) {
	for (let tag of val[SerializerOptions.PropertiesKey]) {
		//console.log(tag);
		this.FPropertyTag(tag);
		this.FPropertyValue(tag, val[tag.Name]);
		// Write tag.Size
		this.goBack(tag.size_offset, (headOffset) => this.int32(headOffset-tag.data_offset));
	}
	this.FPropertyTag({ Name:"None" });	//EOL

	if (withExtraBytes)
		this.int32(0);	
}

UBuffer.prototype.FPropertyTag = function(val) {
	val || (val = {});

	//console.debug(val);

	let tag = val;

	tag.tag_offset = this.offset;

	let m;
	if (this.isWriter() && (m = val.Name.match(/\[\d+\]$/))) {
		// STATIC ARRAY case:
		// We must write the original property name, but keep the altered name in tag.Name to properly find the value in JS object
		this.fname(val.Name.slice(0, -m[0].length));
	}
	else
		tag.Name = this.fname(val.Name);

	if (tag.Name == "None")
		return tag;

	tag.Type = this.fname(val.Type);
	tag.size_offset = this.offset;
	tag.Size = this.int32(0);	// as writer we always write 0 this helps identifying cases where we forgot to go back for size
	tag.ArrayIndex = this.int32(val.ArrayIndex);

	// Static arrays are serialized like a series of variables of the same name.
	// At the first tag/value, there's no way to know that we are in an Array (ArrayIndex=0).
	// So we must alter the subsequent properties to differentiate them in the JS object
	if (this.isReader() && tag.ArrayIndex > 0)
		tag.Name += '['+tag.ArrayIndex+']';

	if (tag.Type == "StructProperty") {
		tag.StructName = this.fname(val.StructName);
		tag.StructGuid = this.FGuid(val.StructGuid);
	}
	else if (tag.Type == "BoolProperty") {
		tag.bool_offset = this.offset;
		tag.BoolVal = this.uint8(val.BoolVal);
	}
	else if (tag.Type == "ByteProperty" || tag.Type == "EnumProperty") {
		tag.EnumName = this.fname(val.EnumName);
	}
	else if (tag.Type == "ArrayProperty" || tag.Type == "SetProperty") {
		tag.InnerType = this.fname(val.InnerType);
	}
	else if (tag.Type == "MapProperty") {
		tag.InnerType = this.fname(val.InnerType);
		tag.ValueType = this.fname(val.ValueType);
	}

	tag.HasPropertyGuid = this.uint8(val.HasPropertyGuid) || 0;
	if (tag.HasPropertyGuid)
		tag.PropertyGuid = this.FGuid(val.PropertyGuid);

	tag.data_offset = this.offset;

	return tag;
};

UReader.prototype.FPropertyValue = function(tag) {
	if (tag.Name == "None")	//not supposed to reach this
		return undefined;

	let startOffset = this.offset;
	try {
		let value = this.FPropertyValue_unsafe(tag);
		if (this.offset != startOffset + tag.Size)
			throw "Bad offset";
		return value;
	}
	catch(err) {
		console.error(err);
		let type = tag.Type;
		console.error("Failed deserialize (" + type + " " + tag.Name + ") " + this.offset + " != " + startOffset + "+" + tag.Size);
		console.error(tag);
		if (tag.Size < 10000 || err != "cascade")
			console.error(this.buffer.slice(startOffset, startOffset + tag.Size).toString('hex'));

		if (SerializerOptions.EarlyExit) {
			if (typeof(process) != 'undefined')
				process.exit(1);
			else
				throw 'cascade';
		}

		this.seek(startOffset + tag.Size);
		return null;
	}
}

const NOT_HANDLED = {};

UBuffer.prototype.FPropertyValue_common = function(tag, val) {
	if (tag.Name == "None")
		return undefined;
	else if (tag.Type == "NameProperty")
		return this.fname(val);
	else if (tag.Type == "EnumProperty")
		return this.fname(val);
	else if (tag.Type == "IntProperty")
		return this.int32(val);
	else if (tag.Type == "ObjectProperty")
		return this.object(val);
	else if (tag.Type == "SoftObjectProperty")
		return this.FSoftObjectPath(val);
	else if (tag.Type == "UInt64Property")
		return this.int64(val);
	else if (tag.Type == "Int16Property")
		return this.int16(val);
	else if (tag.Type == "UInt16Property")
		return this.uint16(val);
	else if (tag.Type == "Int64Property")
		return this.int64(val);
	else if (tag.Type == "FloatProperty")
		return this.float(val);
	else if (tag.Type == "DoubleProperty")
		return this.double(val);
	else if (tag.Type == "StrProperty")
		return this.fstring(val);
	else if (tag.Type == "TextProperty")
		return this.ftext(val);
	else if (tag.Type == "MulticastSparseDelegateProperty" || tag.Type == "MulticastInlineDelegateProperty")
		return this.tarray('TScriptDelegate', val);

	return NOT_HANDLED;
}

UReader.prototype.FPropertyValue_unsafe = function(tag) {
	let commonResult = this.FPropertyValue_common(tag);
	if (commonResult !== NOT_HANDLED)
		return commonResult;

	else if (tag.Type == "BoolProperty")
		return tag.BoolVal;

	else if (tag.Type == "ByteProperty") {
		if (tag.EnumName)
			return this.fname();

		if (tag.Size == 1)
			return this.uint8();

		// NOTE: In several cases, impossible to know if this ByteProperty is actually an enum.
		// Try to read it as a one
		try {
			let str = this.fname();
			if (str.match(/[^a-z:0-9_]/i))
				throw 1;
			return str;
		}
		catch(err) {}

		// Fallback to byte or buffer
		if (tag.Size == 8)
			return this.int64();
		else
			return this.raw(tag.Size);
	}
	
	else if (tag.Type == "StructProperty") {
		if (this.NativeSerializedStructs[tag.StructName])
			return this[this.NativeSerializedStructs[tag.StructName]]();

		// Structs without a native seralizer are essentially a FPropertyList
		// But we need to take into account that we cannot predict which structs have a native serializer.
		let result = {};
		result[SerializerOptions.PropertiesKey] = [];
		while (true) {
			if (!this.tryPropertyTag(tag.data_offset+tag.Size)) {
				console.error("Failed to deserialize struct property - likely a native-serialized struct: " + tag.StructName);
				throw 1;
			}

			let innerTag = this.FPropertyTag();

			if (innerTag.Name == "None")
				break;

			result[SerializerOptions.PropertiesKey].push(innerTag);

			//console.debug("-", innerTag.Type, innerTag.Name, innerTag.Size);
			result[innerTag.Name] = this.FPropertyValue(innerTag);
		}
		return result;
	}

	else if (tag.Type == "ArrayProperty") {
		let result = [];
		result.length = this.int32();

		if (tag.InnerType == "StructProperty") {
			// struct tag is only present once at the start of the array
			tag.InnerTag = this.FPropertyTag();
		}
		else {
			// Use a fake tag to read recursively
			tag.InnerTag = { Type: tag.InnerType, Size: (tag.Size-4) };

			if (tag.InnerType.match(/(Bool|U?Int.?.?|Float|Double|Byte)Property/))
				tag.InnerTag.Size /= result.length; // Fixed type size

			if (tag.InnerType == "BoolProperty")
				tag.InnerTag.Type = "ByteProperty";
		}

		for (let i=0; i<result.length; i++)
			result[i] = this.FPropertyValue_unsafe(tag.InnerTag);

		return result;
	}

	else if (tag.Type == "MapProperty") {
		// We read Maps as array of pairs, because keys can be complex
		let result = [];

		let something = this.int32();	//what is this????

		result.length = this.int32();

		// NOTE: The type of inner struct(s) are not serialized (unlike Arrays).
		//   Generic structs are serialized as FPropertyList so we can parse them,
		//   However native-serialized structs contain basically no information about their type or contents.
		//   Need to identify when we fail to parse a FPropertyTag, and fall back to raw buffer.

		let tryParseItem = (innerTag) => {
			if (innerTag.Type == "BoolProperty")
				innerTag.Type = "IntProperty";
			return this.FPropertyValue_unsafe(innerTag);
		};

		tag.InnerTag = { Type: tag.InnerType, Size: tag.Size-8 };	//again, Size is a bad estimate
		tag.ValueTag = { Type: tag.ValueType, Size: tag.Size-8 };

		// Use a generic '<PropName>:KeyStructType' struct type so we can fill it later on in the NativeSerializedStructs
		if (tag.InnerType == "StructProperty")
			tag.InnerTag.StructName = tag.Name+":KeyStructType";
		if (tag.ValueType == "StructProperty")
			tag.ValueTag.StructName = tag.Name+":ValueStructType";

		try {
			for (let i=0; i<result.length; i++) {
				result[i] = {
					key: tryParseItem(tag.InnerTag),
					value: tryParseItem(tag.ValueTag),
				};
			}
		}
		catch(err) {
			// If we cannot parse the Map correctly, grab its buffer instead
			tag.MapAsBuffer = true;
			this.seek(tag.data_offset);
			result.buffer = this.raw(tag.Size);
			console.warn("read TMap as buffer:", tag);
			console.warn(result.buffer.toString('hex'));
		}

		return result;
	}

	else if (tag.Type == "SetProperty") {
		// Set properties are problematic like maps - the inner property tag is not serialized.
		// We've got an array of removed entries, followed by an array of added entries (based on Defaults).

		let result = { removed:[], added:[] };

		result.removed.length = this.int32();

		let tryParseItem = (innerTag) => {
			if (innerTag.Type == "BoolProperty")
				innerTag.Type = "IntProperty";
			return this.FPropertyValue_unsafe(innerTag);
		};

		tag.InnerTag = { Type: tag.InnerType, Size: tag.Size-8 };
		if (tag.InnerType == "StructProperty")
			tag.InnerTag.StructName = tag.Name+":InnerStructType";

		try {
			for (let i=0; i<result.removed.length; i++)
				result.removed[i] = tryParseItem(tag.InnerTag);

			result.added.length = this.int32();
			for (let i=0; i<result.added.length; i++)
				result.added[i] = tryParseItem(tag.InnerTag);
		}
		catch(err) {
			tag.SetAsBuffer = true;
			this.seek(tag.data_offset);
			result.buffer = this.raw(tag.Size);
			console.warn("read TSet as buffer:", tag);
			console.warn(result.buffer.toString('hex'));
		}
		
		return result;
	}

	else {
		console.warn("read PropType as buffer:", tag);
		let buf = this.raw(tag.Size);
		console.warn(buf.toString('hex'));
		return buf;
	}
}

UReader.prototype.tryPropertyTag = function(outerOffsetLimit) {
	let bkpOffset = this.offset;
	try {
		let tag = this.FPropertyTag();
		//console.log(bkpOffset, this.offset, tag, outerOffsetLimit);
		if (!tag.Name || (tag.Name != "None" && (this.offset >= outerOffsetLimit || !tag.Type || tag.Type.match(/[^a-z]/i) || tag.Type.indexOf("Property") < 3)))
			throw 1;
		this.seek(bkpOffset);
		return true;
	}
	catch(err) {
		this.seek(bkpOffset);
		return false;
	}
}

UWriter.prototype.FPropertyValue = function(tag, val) {
	let commonResult = this.FPropertyValue_common(tag, val);
	if (commonResult !== NOT_HANDLED)
		return commonResult;

	else if (tag.Type == "BoolProperty") {
		// Write tag.BoolVal
		this.goBack(tag.bool_offset, () => this.uint8(val));
	}

	else if (tag.Type == "ByteProperty") {
		if (tag.EnumName)
			return this.fname(val);

		if (tag.Size == 1)
			return this.uint8(val);

		if (typeof(val) == 'string')
			return this.fname(val);

		if (tag.Size == 8)
			return this.int64(val);

		// Fallback to buffer
		this.raw(0, val);
	}

	else if (tag.Type == "StructProperty") {
		if (this.NativeSerializedStructs[tag.StructName])
			return this[this.NativeSerializedStructs[tag.StructName]](val);
		else
			return this.FPropertyList(val, false);
	}

	else if (tag.Type == "ArrayProperty") {
		this.int32(val.length);

		if (tag.InnerType == "StructProperty")
			this.FPropertyTag(tag.InnerTag);

		for (let i=0; i<val.length; i++)
			this.FPropertyValue(tag.InnerTag, val[i]);

		//NOTE: not sure what tag.Size is supposed to mean for array of structs, since there's a single tag for all structs of dynamic sizes
		if (tag.InnerType == "StructProperty")
			this.goBack(tag.InnerTag.size_offset, (headOffset) => this.int32(headOffset-tag.InnerTag.data_offset));
	}

	else if (tag.Type == "MapProperty") {
		if (tag.MapAsBuffer)
			return this.raw(0, val.buffer);

		this.int32(0);
		this.int32(val.length);
		for (let i=0; i<val.length; i++) {
			this.FPropertyValue(tag.InnerTag, val[i].key);
			this.FPropertyValue(tag.ValueTag, val[i].value);
		}
	}

	
	else if (tag.Type == "SetProperty") {
		if (this.SetAsBuffer)
			return this.raw(0, val.buffer);

		val.removed || (val.removed = []);
		this.int32(val.removed.length);
		for (let i=0; i<val.removed.length; i++)
			this.FPropertyValue(tag.InnerTag, val.removed[i]);

		val.added || (val.added = []);
		this.int32(val.added.length);
		for (let i=0; i<val.added.length; i++)
			this.FPropertyValue(tag.InnerTag, val.added[i]);
	}

	else {
		console.warn("write PropType as buffer:", tag.Type, tag.Size, tag.Name);
		this.raw(0, val);
	}
}

//============================================================
// TQ2 static structures

UBuffer.prototype.FSaveGameData = function(val) {
	val || (val = {});
	let result = {
		Name: this.fname(val.Name),
		Class: this.object(val.Class),
	};

	// ByteData size
	let offsetOfSize = this.offset;
	this.int32(0);

	// Serialize ByteData directly as FPropertyList
	result.Data = this.FPropertyList(val.Data, true);

	// Go back to write the size
	if (this.isWriter())
		this.goBack(offsetOfSize, (headOffset) => this.int32(headOffset - offsetOfSize - 4));

	return result;
}
UBuffer.registerNativeStruct('FSaveGameData');

UBuffer.prototype.FTQ2FogOfWarPackedData = function(val) {
	val || (val = {});
	return {
		CompressedData: this.tarray('uint8', val.CompressedData),
		TextureSize: this.int32(val.TextureSize),
		Unknown: this.uint8(val.Unknown),
	};
}
UBuffer.registerNativeStruct('FTQ2FogOfWarPackedData');

UBuffer.prototype.FGrimAppearanceHandle = function(val) {
	val || (val = {});
	let result = {
		DataSize: this.int32(val.DataSize),
		bHasData1: this.int32(val.bHasData1),
	};
	if (result.bHasData1)
		result.Data1 = this.FPropertyList(val.Data1, true);

	result.bHasData2 = this.int32(val.bHasData2);
	if (result.bHasData2)
		result.Data2 = this.FPropertyList(val.Data2, true);

	if (!result.bHasData1 && !result.bHasData2)
		result.pAppearance = this.fstring(val.pAppearance);

	return result;
}
UBuffer.registerNativeStruct('FGrimAppearanceHandle');

UBuffer.prototype.FGrimItemInstanceHandle = function(val) {
	val || (val = {});
	let result = {
		ObjectPath: this.FSoftObjectPath(val.ObjectPath),
		bHasData: this.int32(val.bHasData),
	};
	if (result.bHasData)
		result.Data = this.FPropertyList(val.Data, true);
	return result;
}
UBuffer.registerNativeStruct('FGrimItemInstanceHandle');

UBuffer.prototype.FGrimPtr_IntClassNameProps = function(val) {
	val || (val = {});
	let result = {
		Unknown: this.int32(val.Unknown),
		Class: this.fname(val.Class),
	};
	if (result.Class != "None") {
		result.Name = this.fname(val.Name);
		result.Data = this.FPropertyList(val.Data, true);
	}
	return result;
}
UBuffer.registerNativeAlias('GrimInstancedAppearancePtr', 'FGrimPtr_IntClassNameProps');
UBuffer.registerNativeAlias('GrimArchetypeInstancedBaseMeshEntrySelectorPtr', 'FGrimPtr_IntClassNameProps');
UBuffer.registerNativeAlias('GrimArchetypeInstancedMaterialOverrideSelectorPtr', 'FGrimPtr_IntClassNameProps');
UBuffer.registerNativeAlias('GrimDialogueVariablesSaveStatePtr', 'FGrimPtr_IntClassNameProps');

UBuffer.registerNativeAlias('TQ2MasteryDescriptionPtr', 'FSoftObjectPath');
UBuffer.registerNativeAlias('GrimItemDescriptionPtr', 'FSoftObjectPath');
UBuffer.registerNativeAlias('TQ2MasteryDescriptionSoftPtr', 'FSoftObjectPath');

UBuffer.registerNativeAlias('m_EquippedAppearances:ValueStructType', 'FGrimAppearanceHandle');
UBuffer.registerNativeAlias('m_VisitedTorches:InnerStructType', 'FGuid');
UBuffer.registerNativeAlias('m_CollectedItems:InnerStructType', 'FSoftObjectPath');

UBuffer.prototype.FGrimDialogueVariableValue = function(val) {
	val || (val = {});
	let result = {
		Type: this.uint8(val.Type),
	};
	if (result.Type == 0)
		result.Value = this.int32(val.Value);
	else if (result.Type == 1)
		result.Value = this.int64(val.Value);
	else if (result.Type == 3)
		result.Value = this.fstring(val.Value);
	return result;
}
UBuffer.registerNativeAlias('m_VariableValues:ValueStructType', 'FGrimDialogueVariableValue');

// guessed type
UBuffer.prototype.FGrimSettingsSection = function(val) {
	val || (val = {});
	let result = {
		Name: this.fstring(val.Name),
		NumProperties: this.int32(val.NumProperties),
		Properties: {},
	};
	const SETTINGS_PROP_MAP = {
		m_StickDeadZone: 'float',
		m_HasShownFirstTimeSettingsPrompt: 'uint8',
		m_CursorScale: 'float',
		m_ItemColorScheme: 'fname',
		m_AlwaysShowStatsOnOrbs: 'uint8',
		m_ShowReservationOnOrbs: 'uint8',
		m_OverheadVisibilityPreferences: 'FPreferencesByTarget',
		m_ColorBlindMode: 'fname',
		m_ColorBlindStrength: 'int32',
		m_EnableTutorials: 'uint8',
		m_EnableFailedAbilityFeedback: 'uint8',
		m_HideHelmet: 'uint8',
		m_EnableAutoEquip: 'uint8',
		m_AllowQuickDialogueSkipping: 'uint8',
		m_FCTShowDamage: 'uint8',
		m_FCTShowHeal: 'uint8',
		m_FCTShowImmune: 'uint8',
		m_FCTShowXP: 'uint8',
		m_LootPlateVisibility: 'fname',
		m_LootPlateVisibleInCombat: 'uint8',
		m_LootPlateInteractability: 'fname',
		m_LootPlateInteractableInCombat: 'uint8',
		m_LootTooltipVisibility: 'fname',
		m_LootTooltipVisibleInCombat: 'uint8',
		m_TelemetryConsent: 'fname',
		m_CurrentInputPreset: 'fname',
		m_InputBehaviorLMB: 'fname',
		m_KeepTargetForRepeatedCasts: 'uint8',
		m_UseFreeAimForStationaryCasts: 'uint8',
	};
	if (this.isReader()) {
		for (let i=0; i<result.NumProperties; i++) {
			let propName = this.fstring();
			let propType = SETTINGS_PROP_MAP[propName];
			result.Properties[propName] = this[propType]();
		}
	}
	else {
		for (let k in val.Properties) {
			this.fstring(k);
			let propType = SETTINGS_PROP_MAP[k];
			this[propType](val.Properties[k]);
		}
	}
	return result;
}

// guessed type - array of static arrays of ETQ2OverHeadVisibilityPreference with property tags ???
UBuffer.prototype.FPreferencesByTarget = function(val) {
	if (this.isReader()) {
		let result = [];
		result.length = this.int32();
		for (let i=0; i<result.length; i++)
			result[i] = this.FPropertyList(null, false);
		return result;
	}
	else {
		this.int32(val.length);
		for (let item of val)
			this.FPropertyList(item, false);
	}
}

//============================================================
// Top-level structures

UBuffer.prototype.File_Data_Player =
UBuffer.prototype.File_Data_PlayerLocal =
UBuffer.prototype.File_Data_WorldCampaign =
UBuffer.prototype.File_Data_WorldFluff =
UBuffer.prototype.File_Header =
UBuffer.prototype.File_PublicCrossCharacterSaveData =
function(val) {
	val || (val = {});
	return {
		Header: this.FSaveGameHeader(val.Header),
		Data: this.FPropertyList(val.Data, true),
	};
}

UBuffer.prototype.File_SharedGameSettings =
function(val) {
	val || (val = {});
	return {
		Header: this.FSaveGameHeader(val.Header),
		Data: this.FPropertyList(val.Data, true),
		Sections: this.tarray('FGrimSettingsSection', val.Sections),
	};
}

//============================================================
// Custom JSON serializer (more compact & readable output)

function ToJson(inValue, indentStr, forceInline) {
	if (inValue === undefined)
		return "undefined";
	if (typeof(inValue) == 'number' || typeof(inValue) == 'boolean' || typeof(inValue) == 'bigint')
		return String(inValue);
	if (typeof(inValue) == 'string')
		return JSON.stringify(inValue);
	if (typeof(inValue) == 'object') {
		if (!inValue)
			return "null";

		indentStr || (indentStr = '');
		const indentStr2 = indentStr + SerializerOptions.JsonIndentUnit;

		if (inValue instanceof Array) {
			// Serialize arrays inline, if there are subobjects they will pretty themselves
			let result = '[';
			for (let i=0; i<inValue.length; i++)
				result += (i>0 ? ',' : '') + ToJson(inValue[i], indentStr, forceInline);
			result += ']';

			// If array is effectively inline, see if it makes more sense to print line-by-line instead
			if (result.indexOf('\n') == -1 && inValue.length > 1 && result.length > 100 && result.length/inValue.length > 4) {
				result = '[';
				for (let item of inValue)
					result += '\n' + indentStr2 + ToJson(item) + ',';
				result = result.slice(0,-1) + '\n' + indentStr + ']';
			}

			return result;
		}

		// Object case
		let result = '{';
		for (let k in inValue) {
			// Skip undefined values
			if (inValue[k] === undefined)
				continue;

			if (SerializerOptions.JsonSkipReflection && k == SerializerOptions.PropertiesKey)
				continue;

			// Serialize key (assumed it has no double quotes)
			if (forceInline)
				result += ' "'+k+'": ';
			else
				result += '\n'+indentStr2+'"'+k+'": ';

			// Special cases
			// 1. Force-serialize array as one line per item
			if (inValue[k] instanceof Array && (
					k == 'CustomVersions'
					|| k == SerializerOptions.PropertiesKey
			)) {
				result += '[';
				for (let item of inValue[k])
					result += '\n' + indentStr2 + SerializerOptions.JsonIndentUnit + ToJson(item, "", true) + ',';
				if (inValue[k].length == 0)
					result += '],';
				else
					result = result.slice(0,-1) + '\n'+indentStr2+'],';
			}
			// 2. Compressed data
			else if (k == 'CompressedData') {
				result += '[';
				let linePos = result.lastIndexOf('\n');
				for (let item of inValue[k]) {
					if ((result.length - linePos) > 180) {
						result += '\n' + indentStr2 + SerializerOptions.JsonIndentUnit;
						linePos = result.lastIndexOf('\n');
					}
					result += ToJson(item) + ',';
				}
				if (inValue[k].length == 0)
					result += '],';
				else
					result = result.slice(0,-1) + '],';
			}
			// Default case
			else
				result += ToJson(inValue[k], indentStr2, forceInline)+',';
		}
		if (result.length == 1)
			return result+'}';
		else if (forceInline)
			return result.slice(0,-1) + ' }';
		else
			return result.slice(0,-1) + '\n'+indentStr+'}';
	}
	return "";
}

//============================================================
// Exports

let SerializerOptions = {

	// Stop immediately in case of failure, rather than trying to recover when possible
	EarlyExit: false,

	// Property name used to store reflection data
	PropertiesKey: '__props__',

	// Skips all reflection data when using ToJson
	JsonSkipReflection: false,

	// Indent unit when using ToJson
	JsonIndentUnit: '\t',

};

const TQ2SS = {
	UBuffer,
	UReader,
	UWriter,
	ToJson,
	Options: SerializerOptions,
};
if (typeof(window) != 'undefined')
	window.TQ2SS = TQ2SS;
else
	module.exports = TQ2SS;

})();
