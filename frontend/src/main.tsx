import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './app/App';
import './styles.css';
import './app/portal.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<BrowserRouter><App /></BrowserRouter>);
