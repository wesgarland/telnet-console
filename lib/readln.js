/**
 *  @file       readln.js   
 *  @author     Wes Garland, wes@kingsds.network
 *  @date       April 2020, Jan 2021
 */ 
"use strict";
const process = require('process');

/** Read a line of input from a stream, emulating standard UNIX terminal line 
 *  discipline. Input stream must be ASCII or UTF-8.
 *
 *  @param    {object}  istream     The input stream
 *  @param    {string}  echoChar    The charater to echo when a key is pressed.  When
 *                                  undefined, nothing is echoed. When true, the input
 *                                  character is (more or less) echoed back.  More or
 *                                  less because, rather than typical full-duplex terminal
 *                                  emulation that echoes the exact input, in our case
 *                                  the input is converted from UTF-8 to UTF-16 for output.
 *  @param    {number}  bufSize     An optional parameter to specify the buffer size. 
 *                                  A large (256-byte?) buffer will perform when when reading
 *                                  large amounts of data, however the 1-byte default
 *                                  will prevent this code from consuming extra data from
 *                                  the input stream.
 *  @param    {object}  ostream     The output stream; optional; default = istream
 *
 *  @returns  {string}  normalized UTF-16 representation of input.  Newline is discarded. 
 *                      Invalid input could yield unpaired surrogates in the output.
 * 
 *  @note  Known Bugs - when using echoChar = true, there will be display bugs for 
 *         erase and kill when dealing with codepoints outside of the BMP, as well as
 *         unpaired surrogates.
 */
exports.readln = async function utils$$rawReadln(istream, echoChar, bufSize, ostream)
{
  var byteBuf;                              /* io buffer */
  var buf = '';                             /* accumulator */
  var ret;
  var initRawMode = istream.isRaw;
  var backup = backupEvents(istream, ['data', 'error', 'end']);
  var _resolve, _reject, leftover;

  if (!istream._readln)
    istream._readln = { leftover: false };
  if (istream.setRawMode && !istream.isRaw)
    istream.setRawMode(true);

  function getData(data) { _resolve(data); }
  function trapEnd()     { _resolve(-1);  }
  function trapError(e)  { _reject(e); }

  istream.on('data',  getData);
  istream.on('end',   trapEnd);
  istream.on('error', trapError);

  if (typeof ostream === 'undefined')
    ostream = istream;
  
  try
  {
    loop: while (true)
    {
      if (!leftover) {
        byteBuf = await new Promise((resolve, reject) => {
          _resolve = resolve;
          _reject = reject;
        });
      } else {
        byteBuf = leftover;
        istream._readln.leftover = false;
      }

      ret = await buildLine(istream, ostream, buf, byteBuf, byteBuf.length, echoChar);
      buf = ret.buf;
      if (ret.done)
        break loop;
    }

    if (istream.setRawMode) {
      ostream.write(Buffer.from([13]));
      ostream.write(Buffer.from([10]));
    }
  }
  finally
  {
    istream.off('data',  getData);
    istream.off('end',   trapEnd);
    istream.off('error', trapError);
    restoreEvents(backup, istream);

    if (typeof initRawMode === 'boolean')
      istream.setRawMode(initRawMode);
  }

  return buf;
}

/** Build up an input line input buffer at a time from a terminal in raw mode.
 *  @param   chbuf    {Buffer}  The input buffer
 *  @param   buf      {string}  The accumulated string in UTF-16
 *  @param   nBytes    {number}  The number of bytes in byteBuf
 *  @param   echoChar {buffer}  The character to echo back for each character-class codepoint
 *  @return  an object containing buf: a new accumulated string and done: a boolean that is true
 *           when we are finished processing the input stream.
 */
async function buildLine(istream, ostream, buf, byteBuf, nBytes, echoChar)
{
  var pos;
  var codepoint;

  for (pos=0; pos < nBytes; pos++)
  {
    if (byteBuf[pos] >= 0xc2)  /* start of utf-8 sequence */
    {
      let res = await consumeUtf8Sequence(byteBuf, pos);
      ({codepoint, pos} = res);
    }
    else
      codepoint = byteBuf[0];
    
    /* Emulate typical UNIX terminal line discipline, eg linux stty -iutf8 */
    switch(codepoint)
    {
      case 3:
        if (ostream === process.stdout)
          process.kill(process.pid, 'SIGINT');
        continue;
      case 8: case 127:
        if (echoChar)
        { /* "rub out" the deleted character */
          let width = (echoChar === true ? require('wcwidth')(buf[buf.length - 1]) : echoChar.length);
          for (let i=0; i < width; i++)
            ostream.write(Buffer.from([8,32,32,8,8]));
        }
        buf = buf.slice(0,-1);
        continue;
      case 4:
        if (!buf.length)
          return { done: true, buf: buf };
      case 10: case 13:
        if (nBytes - pos != 0)
          istream._readln.leftover = byteBuf.slice(pos + 1)
        return { done: true, buf: buf };
      case 21:
        for (let i=0; i < buf.length; i++)
        {
          if (buf.charCodeAt(i) >= 0xd800 && buf.charCodeAt(i) < 0xdc00)
            continue;
          for (let j=0; j < (echoChar || '').length; j++)
            ostream.write(Buffer.from([8,32,8]));
        }
        buf = '';
        continue;
      case 26:
        if (ostream === process.stdout && os.platform !== 'win32')
          process.kill(process.pid, 'SIGTSTP');
        continue;
      case 28:
        if (ostream === process.stdout)
          process.kill(process.pid, 'SIGQUIT');
        continue;
      default:
        if (codepoint < 32)
          continue;
    }

    if (echoChar)
    {
      if (echoChar === true)
        ostream.write(Buffer.from(String.fromCodePoint(codepoint)));
      else
        ostream.write(Buffer.from(echoChar));
    }
    buf = (buf + String.fromCodePoint(codepoint)).normalize();
  }

  return { done: false, buf: buf };
}

/** Take a short nap*/
async function nap()
{
  return new Promise(resolve => setTimeout(resolve, 125/2)); /* 125ms = 100wpm */
}

/** Consume a utf8 sequence from the input buffer. If the input
 *  buffer runs out before the sequence is complete, stdin is
 *  read to finish it.  This code assumes that the input stream
 *  is valid utf8, and handles corrupted input streams poorly.
 *
 *  @param    byteBuf     input buffer filled by unsigned bytes
 *  @param    pos       current position in the input buffer: must point to
 *                      the first byte of a utf8 sequence.
 *
 *  @returns a non-negative integer that is the Unicode code point value
 */
async function consumeUtf8Sequence(byteBuf, pos)
{
  var utf8Buf;
  var nBytes;
  var ret = {};
  var missing;

  if (byteBuf[pos] < 0x80)
    utf8Buf = Buffer.alloc(1);
  else if (byteBuf[pos] >= 0xc2 && byteBuf[pos] <= 0xdf)
    utf8Buf = Buffer.alloc(2);
  else if (byteBuf[pos] >= 0xe0 && byteBuf[pos] <= 0xef)
    utf8Buf = Buffer.alloc(3);
  else if (byteBuf[pos] >= 0xf0 && byteBuf[pos] <= 0xf4) 
    utf8Buf = Buffer.alloc(4);
  else
    throw new Error(`invalid utf8 leading byte 0x${byteBuf[pos].toString(16)}`);
  
  nBytes = byteBuf.copy(utf8Buf, 0, pos, pos + utf8Buf.length);
  pos += nBytes;
  ret.pos = pos;

  for (let utf8Pos = utf8Buf.length - nBytes;
       utf8Pos < utf8Buf.length;
       utf8Pos += nBytes) {
    let nBytes = await fs.read(istream.fd, utf8Buf, utf8Pos, utf8Buf.length - utf8Pos);
    if (nBytes < 0)
      throw new Error('Input stream closed while mid-utf8 sequence');
    if (nBytes === 0)
      await nap();
  }

  ret.codepoint = utf8Buf.toString('utf8').codePointAt(0);
  return ret;
}

/** Get the leftover buffer from the last call to realn()
 *  @param     istream {object}   The input stream
 *  @param     peek    {boolean}  If truey, leave leftovers in place for subsequent calls
 *                                to this function or realn()
 *  @returns  {object} buffer
 */ 
exports.getLeftOver = function utils$$getleftOver(istream, peek)
{
  let lo = istream._readln.leftover;

  if (!peek)
    istream._readln.leftover = false;

  return lo;
}

/** Prompt for a password, read the password, and resolve the returned
 *  promise with the password.
 *
 *  @param   {string} prompt      The string to print before waiting for the password
 *  @param   {string} echoChar    The character to echo back, or undefined.
 *  @param   {object} istream     The input stream
 *  @param   {object} ostream     The output stream; optional; default = istream
 *
 *  @returns Promise
 */
exports.readPass = async function utils$$readPass(prompt, echoChar, istream, ostream)
{
  if(!ostream.isTTY)
    console.error("Passphrase prompt may be hidden because stdout is not tty.");

  ostream.write(prompt);

  return exports.readln(istream, echoChar, undefined, ostream);
}

/**
 * Backup event listeners, removing them from the event emitter but preserving
 * them in the backup object.
 *
 * @param     {object}   eventEmitter            an instance of events::EventEmitter
 * @param     {Array}    eventNames              an optional list of event names; default=all
 * 
 * @returns   The backup object
 */
function backupEvents(eventEmitter, eventNames)
{ 
  var backup = {};
  if (!eventNames)
    eventNames = eventEmitter.eventNames();

  for (let eventName of eventNames)
  {
    backup[eventName] = [];
    for (let listener of eventEmitter.listeners(eventName))
    {
      backup[eventName].push(listener);
      eventEmitter.off(eventName, listener);
    }
  }

  return backup;
}

/**
 * Restore event emitters in the format from backupEvents.
 * 
 * @param     {object}   backup                  The backup object
 * @param     {object}   eventEmitter            an instance of events::EventEmitter
 * @param     {Array}    eventNames              an optional list of event names; backup=all
 */
function restoreEvents(backup, eventEmitter, eventNames)
{
  if (!backup)
    return;

  for (let eventName of (eventNames || Object.keys(backup)))
  {
    for (let listener of backup[eventName])
      eventEmitter.on(eventName, listener);
    delete backup[eventName];
  }
}

/* LANG warning on initial module load */
if (process.env.LANG && process.env.LANG !== 'C' && !process.env.LANG.match(/UTF-?8/g)) {
  console.log(`Warning: input language ${process.env.LANG} not supported; assuming UTF-8`);
}
