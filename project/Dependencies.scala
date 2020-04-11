import sbt._
import Keys._
import org.scalajs.sbtplugin.ScalaJSPlugin
import org.scalajs.sbtplugin.ScalaJSPlugin.autoImport._
import org.portablescala.sbtplatformdeps.PlatformDepsPlugin.autoImport._

object Version {
  final val Scala211 = "2.11.11"
  final val Scala212 = "2.12.10"
  final val Scala213 = "2.13.1"

  final val Slinky         = "0.6.5"
  final val Scalajs        = org.scalajs.sbtplugin.ScalaJSPlugin.AutoImport.scalaJSVersion
  final val ScalajsBundler = "0.15.0-0.6"
  final val ScalaTest      = "3.0.8"
  final val Sangria        = "2.0.0-M1"

}

object Library {
  final val sangria   = "org.sangria-graphql"              %% "sangria"      % Version.Sangria
  final val scalatest = "org.scalatest"                    %% "scalatest"    % Version.ScalaTest % Test
  final val slinky    = libraryDependencies += "me.shadaj" %%% "slinky-core" % Version.Slinky
}
