import sbt._
import Keys._
import org.scalajs.sbtplugin.ScalaJSPlugin
import org.scalajs.sbtplugin.ScalaJSPlugin.autoImport._
import org.portablescala.sbtplatformdeps.PlatformDepsPlugin.autoImport._

object Version {
  final val Scala211 = "2.11.11"
  final val Scala212 = "2.12.10"
  final val Scala213 = "2.13.6"

  final val Slinky  = "0.6.7"
  final val Scalajs = org.scalajs.sbtplugin.ScalaJSPlugin.autoImport.scalaJSVersion

  final val ScalaTest = "3.1.4"

}

object Library {
  final val scalatest = "org.scalatest"                    %% "scalatest"    % Version.ScalaTest % Test
  final val slinky    = libraryDependencies += "me.shadaj" %%% "slinky-core" % Version.Slinky
}
