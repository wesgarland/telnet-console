/**
 * @file        expand-path.js
 *              Utility code for expanding pathnames.
 * @author      Wes Garland, wes@kingsds.network
 * @date        June 2021
 */
'use strict';

/** 
 * Resolve pathnames via usual bash tilde-expand rules. Does not glob.
 * @note  Homedirs for other than the current user may be incorrect on 
 *        non-unix platforms.
 */
exports.expandPath = function utils$$sh$expandPath(pathname, homedir) {
  const os = require('os');
  const path = require('path');

  var re, match, self;

  if (!pathname)
    return pathname;

  if (path.isAbsolute(pathname))
    return pathname;

  if (pathname === '~')
    return os.homedir();
  
  if (pathname === '~+')
    return process.cwd();
  
  if (pathname.startsWith('~' + path.sep))
    return path.resolve(os.homedir(), pathname.slice(2));

  self = os.userInfo.username;

  re = new RegExp('~([^\\/]+)([\\/]|$)(.*)');
  if ((match = re.exec(pathname))) {
    let user = match[1];
    let rest = match[3];

    if (user === self)
      return path.resolve(os.homedir(), rest);

    return path.resolve(exports.locateHomeDir(user), rest);
  }

  if (pathname.startsWith('.' + path.sep) || pathname.startsWith('..' + path.sep))
    return path.resolve(process.cwd(), pathname);

  return path.resolve(pathname);
}

/** 
 * Locate a given user's home directory.  We guess on Win32 and read
 * the passwd file on Unix-like.
 */
exports.locateHomeDir = function utils$$sh$locateHomeDir(username) {
  const os = require('os');
  const fs = require('fs');
  
  if (os.platform() === 'win32')
    return path.resolve(os.homedir(), '..', username);

  var epw = fs.readFileSync('/etc/passwd', 'ascii');
  var entries = epw.split('\n');
  var names = entries.map((a) => a.replace(/:.*/,''));
  var idx = names.indexOf(username);

  if (idx === -1)
    throw new Error('No such user: ' + username);

  return entries[idx].split(':')[5];
}
