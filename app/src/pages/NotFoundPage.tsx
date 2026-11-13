import { Link } from 'react-router-dom';
import { EmptyState, Button } from '../components/ui';

export default function NotFoundPage() {
  return (
    <EmptyState title="Page not found" body="That page doesn't exist or you don't have access to it."
      action={<Link to="/"><Button>Back to Home</Button></Link>} />
  );
}
