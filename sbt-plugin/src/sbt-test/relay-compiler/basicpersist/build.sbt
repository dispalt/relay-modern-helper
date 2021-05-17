name := "basic"

libraryDependencies += "org.scala-js" %%% "scalajs-dom" % "1.1.0"

enablePlugins(RelayGeneratePlugin, ScalaJSBundlerPlugin)

scalacOptions += "-Ymacro-annotations"

scalaVersion := "2.13.6"

useYarn := true

relaySchema := (Compile / resourceDirectory).value / "testschema.graphql"

relayDebug := true

Compile / relayPersistedPath := Some((Compile / resourceDirectory).value / "persist.json")

npmDevDependencies in Compile ++= Seq(
  "relay-compiler-language-scalajs" -> "0.25.13",
  "relay-compiler"                  -> "11.0.0",
  "graphql"                         -> "^15.4.0"
)

relayDisplayOnlyOnFailure in Compile := true

Compile / relayNpmDir := (Compile / npmInstallDependencies).value
