import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

export default function BlogAdminPage() {
  const [posts,   setPosts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/cms/blog');
      setPosts(data || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function deletePost(post) {
    if (!(await confirm(`Delete post "${post.title}"? This cannot be undone.`))) return;
    try {
      await api.delete(`/cms/blog/${post.id}`);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
    } catch (e) {
      toast(parseApiError(e, 'Delete failed'), 'error');
    }
  }

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

  return (
    <div>
      <PageHeader
        title="Blog Posts"
        subtitle="Manage blog content"
        actions={
          <button
            className="btn btn-primary d-flex align-items-center gap-2"
            onClick={() => navigate('/admin/blog-posts/new')}
          >
            <iconify-icon icon="solar:add-circle-line-duotone" />
            New Post
          </button>
        }
      />

      {loading ? (
        <div className="text-center py-5">
          <span className="spinner-border text-primary" />
        </div>
      ) : posts.length === 0 ? (
        <div className="empty-state">No blog posts yet. Click New Post to create one.</div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="bg-light">
                <tr>
                  <th>Title</th>
                  <th>Slug</th>
                  <th>Status</th>
                  <th>Author</th>
                  <th>Published</th>
                  <th style={{ width: 140 }}></th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id}>
                    <td className="fw-medium">{post.title}</td>
                    <td className="text-muted small font-monospace">/blog/{post.slug}</td>
                    <td>
                      <span className={`badge bg-${post.status === 'published' ? 'success' : 'secondary'}`}>
                        {post.status}
                      </span>
                    </td>
                    <td className="text-muted small">{post.author_name || '—'}</td>
                    <td className="text-muted small">{fmtDate(post.published_at)}</td>
                    <td className="text-end">
                      <button
                        className="btn btn-sm btn-light me-1"
                        title="Edit"
                        onClick={() => navigate(`/admin/blog-posts/${post.id}/edit`)}
                      >
                        <iconify-icon icon="solar:pen-line-duotone" />
                      </button>
                      <a
                        className="btn btn-sm btn-light me-1"
                        href={`/blog/${post.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Preview"
                      >
                        <iconify-icon icon="solar:eye-line-duotone" />
                      </a>
                      <button
                        className="btn btn-sm btn-light text-danger"
                        title="Delete"
                        onClick={() => deletePost(post)}
                      >
                        <iconify-icon icon="solar:trash-bin-trash-line-duotone" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
