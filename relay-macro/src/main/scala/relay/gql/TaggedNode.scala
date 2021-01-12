package relay.gql

import scala.language.implicitConversions
import scala.scalajs.js

/** This is one level higher than what's returned by relay, the query is what's returned by `Relay` */
trait GenericGraphQLTaggedNode {
  def query: TaggedNode
}

/** The typed version */
trait TypedGraphQLTaggedNode[I <: js.Object, O <: js.Object] extends GenericGraphQLTaggedNode

object GenericGraphQLTaggedNode {
  implicit def ggql2jsObj(ggqltn: GenericGraphQLTaggedNode): TaggedNode = {
    ggqltn.query
  }
}

trait QueryTaggedNode[I <: js.Object, O <: js.Object] extends TypedGraphQLTaggedNode[I, O] {
  type Input = I
  type Out   = O
}

object QueryTaggedNode {
  implicit def ggql2jsObj[I <: js.Object, O <: js.Object](ggqltn: QueryTaggedNode[I, O]): TaggedNode = {
    ggqltn.query
  }
}

trait MutationTaggedNode[I <: js.Object, O <: js.Object] extends TypedGraphQLTaggedNode[I, O] {
  type Input = I
  type Out   = O
}

object MutationTaggedNode {
  implicit def ggql2jsObj[I <: js.Object, O <: js.Object](ggqltn: MutationTaggedNode[I, O]): TaggedNode = {
    ggqltn.query
  }
}

/** This is what all the Relay components request */
trait TaggedNode extends js.Object

@js.native
trait ConcreteFragment extends TaggedNode

@js.native
trait ConcreteBatch extends TaggedNode

@js.native
trait ReaderFragment extends TaggedNode

@js.native
trait ConcreteRequest extends TaggedNode
