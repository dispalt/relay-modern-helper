import sbtrelease.ReleaseCustom
import sbtrelease.ReleasePlugin.autoImport.{ReleaseStep, _}
import sbtrelease.ReleaseStateTransformations._

import scala.sys.process._

val sbtVersions = List("1.4.6")

crossSbtVersions := sbtVersions

// Run slinky-relay-ijext/updateIntellij
ThisBuild / updateIntellij := {}

lazy val root =
  project
    .in(file("."))
    .settings(commonSettings)
    .settings(PgpKeys.publishSigned := {}, publishLocal := {}, publishArtifact := false, publish := {})
    .settings(
      // crossScalaVersions must be set to Nil on the aggregating project
      crossScalaVersions := Nil,
      publish / skip := true
    )
    .aggregate(`sbt-relay-compiler`, `relay-macro`, `slinky-relay`)

def RuntimeLibPlugins = Sonatype && PluginsAccessor.exclude(BintrayPlugin)
def SbtPluginPlugins  = BintrayPlugin && PluginsAccessor.exclude(Sonatype)

lazy val `sbt-relay-compiler` = project
  .in(file("sbt-plugin"))
  .enablePlugins(SbtPluginPlugins)
  .enablePlugins(SbtPlugin)
  .settings(bintraySettings)
  .settings(commonSettings)
  .settings(
    sbtPlugin := true,
    addSbtPlugin("org.scala-js"       % "sbt-scalajs"              % Version.Scalajs),
    addSbtPlugin("ch.epfl.scala"      % "sbt-scalajs-bundler"      % Version.ScalajsBundler),
    addSbtPlugin("org.portable-scala" % "sbt-scalajs-crossproject" % "1.0.0"),
    scriptedLaunchOpts += "-Dplugin.version=" + version.value,
    scriptedBufferLog := false,
    scriptedDependencies := {
      val () = scriptedDependencies.value
      val () = (publishLocal in `relay-macro`).value
    },
    crossSbtVersions := sbtVersions,
    scalaVersion := {
      (sbtBinaryVersion in pluginCrossBuild).value match {
        case "0.13" => "2.10.6"
        case _      => Version.Scala212
      }
    },
    crossScalaVersions := Nil,
    publishMavenStyle := isSnapshot.value,
    sourceGenerators in Compile += Def.task {
      Generators.version(version.value, (sourceManaged in Compile).value)
    }.taskValue
  )

lazy val `relay-macro` = project
  .in(file("relay-macro"))
  .enablePlugins(RuntimeLibPlugins && ScalaJSPlugin)
  .settings(commonSettings ++ mavenSettings)
  .settings(crossSbtVersions := Nil, scalacOptions ++= {
    if (scalaJSVersion.startsWith("0.6.")) Seq("-P:scalajs:sjsDefinedByDefault")
    else Nil
  }, libraryDependencies ++= Seq(Library.sangria % Provided, Library.scalatest), macroAnnotationSettings)

lazy val `slinky-relay` = project
  .in(file("slinky-relay"))
  .enablePlugins(RuntimeLibPlugins && ScalaJSPlugin)
  .settings(commonSettings ++ mavenSettings)
  .settings(
    resourceGenerators in Compile += Def.task {
      val rootFolder = (resourceManaged in Compile).value / "META-INF"
      rootFolder.mkdirs()

      IO.write(rootFolder / "intellij-compat.json", s"""{
           |  "artifact": "${organization.value} % slinky-relay-ijext_2.13 % ${version.value}"
           |}""".stripMargin)

      Seq(rootFolder / "intellij-compat.json")
    },
//    scalacOptions ++= {
//      if ()
//      "-Xplugin-require:macroparadise"
//    },
    libraryDependencies ++= Vector(
      "org.scala-lang" % "scala-reflect"    % scalaVersion.value,
      "org.scala-js"   %% "scalajs-library" % scalaJSVersion
    ),
    macroAnnotationSettings,
    Library.slinky
  )
  .dependsOn(`relay-macro`)

lazy val `slinky-relay-ijext` = (project in file("slinky-relay-ijext"))
  .enablePlugins(RuntimeLibPlugins && SbtIdeaPlugin)
  .settings(org.jetbrains.sbtidea.Keys.buildSettings)
  .settings(commonSettings ++ mavenSettings)
  .settings(
    crossScalaVersions := Seq(Version.Scala213),
    intellijPluginName := name.value,
    intellijExternalPlugins += "org.intellij.scala".toPlugin,
    intellijInternalPlugins ++= Seq("java"),
    intellijBuild := "203.5981.155",
    packageMethod := PackagingMethod.Standalone(), // This only works for proper plugins
    patchPluginXml := pluginXmlOptions { xml =>
      // This only works for proper plugins
      xml.version = version.value
      xml.sinceBuild = (intellijBuild in ThisBuild).value
      xml.untilBuild = "203.*"
    },
    resourceGenerators in Compile += Def.task {
      val rootFolder = (resourceManaged in Compile).value / "META-INF"
      rootFolder.mkdirs()
      val fileOut = rootFolder / "intellij-compat.xml"

      IO.write(fileOut, s"""
          |<!DOCTYPE intellij-compat PUBLIC "Plugin/DTD"
          |        "https://raw.githubusercontent.com/JetBrains/intellij-scala/idea183.x/scala/scala-impl/src/org/jetbrains/plugins/scala/components/libextensions/intellij-compat.dtd">
          |<intellij-compat>
          |    <name>Slinky Relay Intellij Support</name>
          |    <description>Expands Slinky relay macros</description>
          |    <version>${version.value}</version>
          |    <vendor>Goodcover</vendor>
          |    <ideaVersion since-build="2020.3.0" until-build="2020.4.0">
          |        <extension interface="org.jetbrains.plugins.scala.lang.psi.impl.toplevel.typedef.SyntheticMembersInjector"
          |                   implementation="slinkyrelay.SlinkyRelayInjector">
          |            <name>Slinky @reactRelay Library Support</name>
          |            <description>Library support and expansion for @reactRelay macro</description>
          |        </extension>
          |        <extension interface="org.jetbrains.plugins.scala.lang.macros.evaluator.ScalaMacroTypeable"
          |             implementation="slinkyrelay.GraphQLGenInjector">
          |            <name>graphqlGen whitebox mac library Support</name>
          |            <description>Support for graphqlGen macro</description>
          |        </extension>
          |    </ideaVersion>
          |</intellij-compat>
          """.stripMargin)

      Seq(fileOut)
    }
  )

lazy val bintraySettings: Seq[Setting[_]] =
  Seq(
    bintrayOrganization := Some("dispalt"), // TODO - Coordinates
    bintrayRepository := "sbt-plugins",
    bintrayPackage := "sbt-relay-compiler",
    bintrayReleaseOnPublish := true
  )

lazy val mavenSettings: Seq[Setting[_]] = Seq(publishMavenStyle := true, publishTo := {
  val nexus = "https://oss.sonatype.org/"
  if (isSnapshot.value) Some("snapshots" at nexus + "content/repositories/snapshots")
  else Some("releases" at nexus + "service/local/staging/deploy/maven2")
})

lazy val macroAnnotationSettings = Seq(
  resolvers += Resolver.sonatypeRepo("releases"),
  scalacOptions ++= {
    if (scalaVersion.value == Version.Scala213) Seq("-Ymacro-annotations")
    else Seq("-Xfuture")
  },
  libraryDependencies ++= {
    if (scalaVersion.value == Version.Scala213) Seq.empty
    else Seq(compilerPlugin(("org.scalamacros" % "paradise" % "2.1.1").cross(CrossVersion.full)))
  }
)

lazy val commonSettings: Seq[Setting[_]] = Seq(
  scalaVersion := Version.Scala213,
  crossScalaVersions := Seq(Version.Scala212, Version.Scala213),
  scalacOptions ++= Seq(
    "-feature",
    "-deprecation",
    "-encoding",
    "UTF-8",
    "-unchecked",
    "-Xlint",
//    "-Yno-adapted-args",
    "-Ywarn-dead-code",
    "-Ywarn-numeric-widen",
    "-Ywarn-value-discard",
    "-language:_",
    "-language:existentials",        // Existential types (besides wildcard types) can be written and inferred
    "-language:experimental.macros", // Allow macro definition (besides implementation and application)
    "-language:higherKinds",         // Allow higher-kinded types
    "-language:implicitConversions"  // Allow definition of implicit functions called views
  ),
  organization := "com.dispalt.relay",  // TODO - Coordinates
  sonatypeProfileName := "com.dispalt", // TODO - Coordinates
  pomExtra :=
    <developers>
        <developer>
          <id>dispalt</id>
          <name>Dan Di Spaltro</name>
          <url>http://dispalt.com</url>
        </developer>
        <developer>
          <id>kolarm</id>
          <name>Marko Kolar</name>
          <url>https://github.com/kolarm</url>
        </developer>
      </developers>,
  homepage := Some(url(s"https://github.com/goodcover/scala-relay")),
  licenses := Seq("MIT License" -> url("http://opensource.org/licenses/mit-license.php")),
  scmInfo := Some(
    ScmInfo(url("https://github.com/goodcover/scala-relay"), "scm:git:git@github.com:goodcover/scala-relay.git")
  )
)

releasePublishArtifactsAction := PgpKeys.publishSigned.value

releaseCrossBuild := false

releaseProcess :=
  Seq[ReleaseStep](
    checkSnapshotDependencies,
    inquireVersions,
    runClean,
    releaseStepCommandAndRemaining("+ test"),
    releaseStepCommandAndRemaining(";+ slinky-relay-ijext/updateIntellij ;+ slinky-relay-ijext/test"),
    setReleaseVersion,
    commitReleaseVersion,
    tagRelease,
    releaseStepCommandAndRemaining("+ publishSigned"),
    releaseStepCommandAndRemaining("^ sbt-relay-compiler/publishSigned"),
    releaseStepCommandAndRemaining("+ slinky-relay-ijext/publishSigned"),
    releaseStepCommandAndRemaining("sonatypeReleaseAll"),
    ReleaseCustom.doReleaseYarn,
    setNextVersion,
    ReleaseCustom.commitNextVersion,
    pushChanges
  )

addCommandAlias("publishLocalAll", ";publishLocal ;slinky-relay-ijext/publishLocal")
