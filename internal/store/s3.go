package store

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// S3Params mirrors the env surface; secrets stay in env, never in the DB.
type S3Params struct {
	Endpoint  string
	Bucket    string
	AccessKey string
	SecretKey string
	Region    string
}

type S3 struct {
	client *s3.Client
	bucket string
}

func NewS3(p S3Params) (*S3, error) {
	cfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithRegion(p.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(p.AccessKey, p.SecretKey, "")),
	)
	if err != nil {
		return nil, fmt.Errorf("store: aws config: %w", err)
	}
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(p.Endpoint)
		o.UsePathStyle = true
	})
	return &S3{client: client, bucket: p.Bucket}, nil
}

func (s *S3) Put(ctx context.Context, key string, r io.Reader, size int64) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		Body:          r,
		ContentLength: aws.Int64(size),
	})
	return err
}

// Open returns a lazy, range-aware reader over the object: no bytes are
// fetched until Read, and each Read pulls only the range it needs from S3
// (http.ServeContent drives it with Seek+Read). Small-object reads collapse
// into a single GET; large media files are served without full-object
// downloads.
func (s *S3) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	fi, err := s.Stat(ctx, key)
	if err != nil {
		return nil, err
	}
	return &s3Reader{ctx: ctx, s: s, key: key, size: fi.Size}, nil
}

// s3Reader implements io.ReadSeekCloser over ranged GetObject calls.
type s3Reader struct {
	ctx    context.Context
	s      *S3
	key    string
	size   int64
	pos    int64
	body   io.ReadCloser // open ranged response, nil when idle
	closed bool

	emptyReads int // consecutive zero-progress ranged responses
}

func (r *s3Reader) Read(p []byte) (int, error) {
	if r.closed {
		return 0, os.ErrClosed
	}
	if r.pos >= r.size {
		return 0, io.EOF
	}
	if r.body == nil {
		if err := r.openRange(r.pos, r.size-r.pos); err != nil {
			return 0, err
		}
	}
	n, err := r.body.Read(p)
	r.pos += int64(n)
	if err == io.EOF {
		r.closeBody()
		// A truncated ranged response ends early; the next Read opens a
		// fresh range from the current position. Only signal end-of-stream
		// once every byte has been delivered.
		if r.pos >= r.size {
			return n, io.EOF
		}
		// No-progress guard: if the object is smaller than the Stat size
		// (replaced object) an empty ranged response would otherwise loop
		// forever, reopening the same range and fetching nothing.
		r.emptyReads++
		if r.emptyReads > 3 {
			return 0, errors.New("store: object shrank below expected size")
		}
		return n, nil
	}
	r.emptyReads = 0
	return n, err
}

func (r *s3Reader) openRange(start, length int64) error {
	out, err := r.s.client.GetObject(r.ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.s.bucket),
		Key:    aws.String(r.key),
		Range:  aws.String(fmt.Sprintf("bytes=%d-%d", start, start+length-1)),
	})
	if err != nil {
		var nf *s3types.NoSuchKey
		if errors.As(err, &nf) {
			return ErrNotFound
		}
		var nf2 *s3types.NotFound
		if errors.As(err, &nf2) {
			return ErrNotFound
		}
		return err
	}
	r.body = out.Body
	return nil
}

func (r *s3Reader) closeBody() {
	if r.body != nil {
		r.body.Close()
		r.body = nil
	}
}

func (r *s3Reader) Seek(offset int64, whence int) (int64, error) {
	if r.closed {
		return 0, os.ErrClosed
	}
	var next int64
	switch whence {
	case io.SeekStart:
		next = offset
	case io.SeekCurrent:
		next = r.pos + offset
	case io.SeekEnd:
		next = r.size + offset
	default:
		return 0, fmt.Errorf("s3: invalid whence %d", whence)
	}
	if next < 0 {
		return 0, fmt.Errorf("s3: negative seek position %d", next)
	}
	// Any repositioning abandons the open range; the next Read opens a fresh
	// ranged GET at the target (http.ServeContent seeks before each read).
	r.pos = next
	r.closeBody()
	return next, nil
}

func (r *s3Reader) Close() error {
	if r.closed {
		return nil
	}
	r.closed = true
	r.closeBody()
	return nil
}

func (s *S3) Stat(ctx context.Context, key string) (FileInfo, error) {
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		var nf *s3types.NotFound
		if errors.As(err, &nf) {
			return FileInfo{}, ErrNotFound
		}
		return FileInfo{}, err
	}
	fi := FileInfo{Size: 0}
	if out.ContentLength != nil {
		fi.Size = *out.ContentLength
	}
	if out.LastModified != nil {
		fi.ModTime = *out.LastModified
	}
	return fi, nil
}

func (s *S3) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	return err
}

func (s *S3) List(ctx context.Context, prefix string) ([]string, error) {
	prefix = strings.Trim(prefix, "/")
	var keys []string
	p := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucket),
		Prefix: aws.String(prefix),
	})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, obj := range page.Contents {
			if obj.Key != nil {
				keys = append(keys, *obj.Key)
			}
		}
	}
	return keys, nil
}
