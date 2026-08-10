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
	// TempDir is where GetObject responses are spooled so reads are seekable
	// (range requests via http.ServeContent). Defaults to os.TempDir().
	TempDir string
}

type S3 struct {
	client *s3.Client
	bucket string
	tmpDir string
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
	tmpDir := p.TempDir
	if tmpDir == "" {
		tmpDir = os.TempDir()
	}
	return &S3{client: client, bucket: p.Bucket, tmpDir: tmpDir}, nil
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

// Open downloads the object into a spool file and returns a seekable reader;
// the file is removed on Close.
func (s *S3) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		var nf *s3types.NoSuchKey
		if errors.As(err, &nf) {
			return nil, ErrNotFound
		}
		var nf2 *s3types.NotFound
		if errors.As(err, &nf2) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	f, err := os.CreateTemp(s.tmpDir, "vod-s3-*")
	if err != nil {
		out.Body.Close()
		return nil, err
	}
	if _, err := io.Copy(f, out.Body); err != nil {
		out.Body.Close()
		f.Close()
		os.Remove(f.Name())
		return nil, err
	}
	out.Body.Close()
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		f.Close()
		os.Remove(f.Name())
		return nil, err
	}
	return &spoolFile{File: f}, nil
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

// spoolFile is a seekable reader backed by a temp file that deletes itself.
type spoolFile struct {
	*os.File
}

func (s *spoolFile) Close() error {
	name := s.Name()
	err := s.File.Close()
	os.Remove(name) // best effort; temp dir handles leftovers
	return err
}
