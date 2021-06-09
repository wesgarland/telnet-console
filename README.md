# nrc - Node Runtime Console

A library for implementing runtime consoles in Node applications. This library allows you to 
trivially build a telnet daemon for your application that can buffer/intercept console log
messages and connect a REPL within a given execution context (usually the main program).

## Security Notes

Telnet is unencrypted and unauthenticated. You should not run it across a network; for this 
reason, the default listen address for this library is localhost:2323.

Additionally, making the REPL available allows anyone who can connect to it to do anything
at all with the same privileges as your application -- so even if you are limiting connections
to localhost, you must trust every single user on your machine.

## Release Notes

### Supported Platforms

### Related Products
Other utilities for developers working with DCP can be retrieved via npm, and include:

* [`niim`](https://www.npmjs.com/package/niim) - a command-line debugger for Node.js (fork of node-inspect) which can debug DCP programs (passphrase prompts cause problems with node-inspect mainline)

