import sbtrelease.ReleasePlugin.autoImport.{ReleaseStep, _}
import sbtrelease.ReleaseStateTransformations._

val sbtVersions = List("0.13.17", "1.2.8")

crossSbtVersions := sbtVersions

lazy val root =
  project
    .in(file("."))
    .settings(commonSettings)
    .settings(PgpKeys.publishSigned := {}, publishLocal := {}, publishArtifact := false, publish := {})
    .settings(
              // crossScalaVersions must be set to Nil on the aggregating project
              crossScalaVersions := Nil,
              publish / skip := true)
    .aggregate(`sbt-relay-compiler`, `relay-macro`)

def RuntimeLibPlugins = Sonatype && PluginsAccessor.exclude(BintrayPlugin)
def SbtPluginPlugins  = BintrayPlugin && PluginsAccessor.exclude(Sonatype)

lazy val `sbt-relay-compiler` = project
  .in(file("sbt-plugin"))
  .enablePlugins(SbtPluginPlugins)
  .enablePlugins(SbtPlugin)
  .settings(bintraySettings)
  .settings(commonSettings)
  .settings(sbtPlugin := true,
            addSbtPlugin("org.scala-js"       % "sbt-scalajs"              % Version.Scalajs),
            addSbtPlugin("ch.epfl.scala"      % "sbt-scalajs-bundler"      % Version.ScalajsBundler),
            addSbtPlugin("org.portable-scala" % "sbt-scalajs-crossproject" % "0.6.0"),
            scriptedLaunchOpts += "-Dplugin.version=" + version.value,
            scriptedBufferLog := false,
////            publishTo := Def.taskDyn {
////              if (isSnapshot.value) {
////                // Bintray doesn't support publishing snapshots, publish to Sonatype snapshots instead
////                Def.task(Option(Opts.resolver.sonatypeSnapshots: Resolver))
////              } else publishTo.value
////            },
            scriptedDependencies := {
              val () = scriptedDependencies.value
//              val () = publishLocal.value
              val () = (publishLocal in `relay-macro`).value
            },
            crossSbtVersions := sbtVersions,
            scalaVersion := {
              (sbtBinaryVersion in pluginCrossBuild).value match {
                case "0.13" => "2.10.6"
                case _      => Version.Scala212
              }
            },
            publishMavenStyle := isSnapshot.value,
            sourceGenerators in Compile += Def.task {
              Generators.version(version.value, (sourceManaged in Compile).value)
            }.taskValue)

lazy val `relay-macro` = project
  .in(file("relay-macro"))
  .enablePlugins(RuntimeLibPlugins && ScalaJSPlugin)
  .settings(commonSettings)
  .settings(publishMavenStyle := true,
            crossSbtVersions := Nil,
            scalaVersion := Version.Scala212,
            scalacOptions ++= {
              if (scalaJSVersion.startsWith("0.6.")) Seq("-P:scalajs:sjsDefinedByDefault")
              else Nil
            },
            crossScalaVersions := Seq(Version.Scala212),
            addCompilerPlugin("org.scalamacros"         % "paradise" % "2.1.0" cross CrossVersion.full),
            libraryDependencies ++= Seq(Library.sangria % Provided, Library.scalatest))

lazy val bintraySettings: Seq[Setting[_]] =
  Seq(bintrayOrganization := Some("dispalt"),
      bintrayRepository := "sbt-plugins",
      bintrayPackage := "sbt-relay-compiler",
      bintrayReleaseOnPublish := true)

lazy val commonSettings: Seq[Setting[_]] = Seq(
  scalacOptions ++= Seq("-feature",
                        "-deprecation",
                        "-encoding",
                        "UTF-8",
                        "-unchecked",
                        "-Xlint",
                        "-Yno-adapted-args",
                        "-Ywarn-dead-code",
                        "-Ywarn-numeric-widen",
                        "-Ywarn-value-discard",
                        "-Xfuture"),
  organization := "com.dispalt.relay",
  sonatypeProfileName := "com.dispalt",
  pomExtra :=
    <developers>
        <developer>
          <id>dispalt</id>
          <name>Dan Di Spaltro</name>
          <url>http://dispalt.com</url>
        </developer>
      </developers>,
  homepage := Some(url(s"https://github.com/dispalt/relay-modern-helper")),
  licenses := Seq("MIT License" -> url("http://opensource.org/licenses/mit-license.php")),
  scmInfo := Some(
    ScmInfo(url("https://github.com/dispalt/relay-modern-helper"),
            "scm:git:git@github.com:dispalt/relay-modern-helper.git")))

releasePublishArtifactsAction := PgpKeys.publishSigned.value

releaseCrossBuild := false

releaseProcess :=
  Seq[ReleaseStep](checkSnapshotDependencies,
                   inquireVersions,
                   runClean,
                   releaseStepCommandAndRemaining("+test"),
                   setReleaseVersion,
                   commitReleaseVersion,
                   tagRelease,
                   if (sbtPlugin.value) releaseStepCommandAndRemaining("^ publishSigned")
                   else releaseStepCommandAndRemaining("+ publishSigned"),
                   releaseStepCommandAndRemaining("sonatypeReleaseAll"),
                   setNextVersion,
                   commitNextVersion,
                   pushChanges)
