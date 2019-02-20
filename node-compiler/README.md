
# relay-compiler-language-scalajs

The purpose of this project is to generate Scala.js bindings for the
`relay-compiler`.  Typically the `relay-compiler` generates `flow` bindings
along with the compiled queries.  This project replaces that generation and
outputs `js.native` traits instead.  It should work on most "normal" gql features. If I personally
run across something not supported I try to add it, but it is by no means totally complete.

This project uses flow because it's what relay uses, and its better than raw javascript.

It uses `artifactDirectory` to generate all the source files and whatnot in the same package.
So its a big flat package repository in the same directory.
Typically `(resourceManaged in Compile).value / "relay-compiler-out"` is where it outputs
in sbt parlance.

### Versions
- `0.20.1` - Relay `2,0,0`
- `0.11.0` - Relay `1.6.2`
- `0.9.0` - Relay `1.5.0`
- `0.8.2` - Relay `1.4.0`

## Example

```sh
$ ./node_modules/bin/relay-compiler --language scalajs --src example/src/ --schema example/schema.graphql --artifactDirectory example/out
```

## Features
 - Handles names elegantly by scoping them to the companion object.
 - Provides two ways to customize the output
 - `@scalajs(extends: String)` This can give you a parent class to mixin.  It's
   your job to verify it.
 - `@scalajs(useNulls: Boolean)` this can give you finer control on using `A | Null`
   on a Fragment, field or inline fragment.


## Example

Looking at the sbt tests is the best way to get a handle on how things work.

[Basic Test](https://github.com/dispalt/scala-relay/tree/01194cfe283b68c0770da1292a0939160fd45dee/sbt-plugin/src/sbt-test/relay-compiler/basic)
